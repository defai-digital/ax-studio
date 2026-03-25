/**
 * useDocumentAttachmentHandler — encapsulates document attachment ingestion
 * (file picker, size validation, dedup, processing pipeline) for ChatInput.
 *
 * Returns callbacks and derived state; no JSX.
 */
import { useCallback, useRef } from 'react'
import {
  ContentType,
  MessageStatus,
  type ThreadMessage,
  fs,
} from '@ax-studio/core'
import { toast } from 'sonner'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useAppState } from '@/hooks/useAppState'
import { useAttachments } from '@/hooks/useAttachments'
import { useChatAttachments } from '@/hooks/useChatAttachments'
import { useAttachmentIngestionPrompt } from '@/hooks/useAttachmentIngestionPrompt'
import { useThreads } from '@/hooks/useThreads'
import { processAttachmentsForSend } from '@/lib/attachmentProcessing'
import { useFileRegistry, threadCollectionId } from '@/lib/file-registry'
import { createDocumentAttachment, type Attachment } from '@/types/attachment'

const ATTACHMENT_AUTO_INLINE_FALLBACK_BYTES = 512 * 1024

type Input = {
  attachmentsKey: string
  effectiveThreadId: string | undefined
}

type Result = {
  handleAttachDocsIngest: () => Promise<void>
  ingestingDocs: boolean
  processNewDocumentAttachments: (docs: Attachment[]) => Promise<void>
  handleRemoveAttachment: (indexToRemove: number) => Promise<void>
}

export function useDocumentAttachmentHandler({ attachmentsKey, effectiveThreadId }: Input): Result {
  const serviceHub = useServiceHub()
  const selectedModel = useModelProvider((state) => state.selectedModel)
  const selectedProvider = useModelProvider((state) => state.selectedProvider)
  const getProviderByName = useModelProvider((state) => state.getProviderByName)
  const activeModels = useAppState((state) => state.activeModels)
  const updateLoadingModel = useAppState((state) => state.updateLoadingModel)
  const setActiveModels = useAppState((state) => state.setActiveModels)
  const parsePreference = useAttachments((s) => s.parseMode)
  const maxFileSizeMB = useAttachments((s) => s.maxFileSizeMB)
  const autoInlineContextRatio = useAttachments((s) => s.autoInlineContextRatio)
  const attachments = useChatAttachments(
    useCallback((state) => state.getAttachments(attachmentsKey), [attachmentsKey])
  )
  const setAttachmentsForThread = useChatAttachments((state) => state.setAttachments)
  const clearAttachmentsForThread = useChatAttachments((state) => state.clearAttachments)

  // Derived
  const ingestingDocs = attachments.some((a) => a.type === 'document' && a.processing)

  // ─── updateAttachmentProcessing ───────────────────────────────────────────
  // Internal helper — updates processing status across all matching keys
  const attachmentsKeyRef = useRef(attachmentsKey)
  attachmentsKeyRef.current = attachmentsKey

  const updateAttachmentProcessing = useCallback(
    (
      fileName: string,
      status: 'processing' | 'done' | 'error' | 'clear_all',
      updatedAttachment?: Partial<Attachment>
    ) => {
      const targetKey = attachmentsKeyRef.current
      const storeState = useChatAttachments.getState()

      const allMatchingKeys = Object.entries(storeState.attachmentsByThread)
        .filter(([, list]) => list?.some((att) => att.name === fileName))
        .map(([key]) => key)

      const keysToUpdate = new Set([targetKey, ...allMatchingKeys])

      const applyUpdate = (key: string) => {
        if (status === 'clear_all') {
          clearAttachmentsForThread(key)
          return
        }
        setAttachmentsForThread(key, (prev) =>
          prev.map((att) =>
            att.name === fileName
              ? {
                  ...att,
                  ...updatedAttachment,
                  processing: status === 'processing',
                  processed:
                    status === 'done'
                      ? true
                      : (updatedAttachment?.processed ?? att.processed),
                }
              : att
          )
        )
      }

      keysToUpdate.forEach((key) => applyUpdate(key as string))
    },
    [clearAttachmentsForThread, setAttachmentsForThread]
  )

  // ─── processNewDocumentAttachments ───────────────────────────────────────
  const processNewDocumentAttachments = useCallback(
    async (docs: Attachment[]) => {
      if (!docs.length) return

      // Mark all docs as processing IMMEDIATELY so the send guard and
      // readyAttachments filter can detect in-flight work before any async
      // operations (model startup, prompt dialog, MCP calls) begin.
      setAttachmentsForThread(attachmentsKey, (prev) =>
        prev.map((att) => {
          const isTarget = docs.some(
            (d) => d.path && att.path && d.path === att.path
          )
          return isTarget ? { ...att, processing: true } : att
        })
      )

      // On the home page effectiveThreadId is undefined — use a temporary ID
      // so that inline parsing still works. Embeddings mode will use this as
      // the AkiDB collection name; the real thread ID is patched later when
      // the thread is created and attachments are transferred.
      const processingThreadId = effectiveThreadId || '__pending__'

      const modelReady = await (async () => {
        if (!selectedModel?.id) return false
        if (activeModels.includes(selectedModel.id)) return true
        const provider = getProviderByName(selectedProvider)
        if (!provider) return false
        try {
          updateLoadingModel(true)
          await serviceHub.models().startModel(provider, selectedModel.id)
          const active = await serviceHub.models().getActiveModels()
          setActiveModels(active || [])
          return active?.includes(selectedModel.id) ?? false
        } catch (err) {
          console.warn('Failed to start model before attachment validation', err)
          return false
        } finally {
          updateLoadingModel(false)
        }
      })()

      const modelContextLength = (() => {
        const ctx = selectedModel?.settings?.ctx_len?.controller_props?.value
        if (typeof ctx === 'number') return ctx
        if (typeof ctx === 'string') {
          const parsed = parseInt(ctx, 10)
          return Number.isFinite(parsed) ? parsed : undefined
        }
        return undefined
      })()

      const rawContextThreshold =
        typeof modelContextLength === 'number' && modelContextLength > 0
          ? Math.floor(
              modelContextLength *
                (typeof autoInlineContextRatio === 'number' ? autoInlineContextRatio : 0.75)
            )
          : undefined

      const contextThreshold =
        typeof rawContextThreshold === 'number' &&
        Number.isFinite(rawContextThreshold) &&
        rawContextThreshold > 0
          ? rawContextThreshold
          : undefined

      // Always ask the user how to process each document (inline vs embeddings).
      // The dialog is rendered at root level in __root.tsx.
      const docsNeedingPrompt = docs.filter((doc) => {
        return !doc.processed && !doc.injectionMode
      })

      const docChoices = new Map<string, 'inline' | 'embeddings'>()

      if (docsNeedingPrompt.length > 0) {
        for (let i = 0; i < docsNeedingPrompt.length; i++) {
          const doc = docsNeedingPrompt[i]
          const choice = await useAttachmentIngestionPrompt
            .getState()
            .showPrompt(doc, ATTACHMENT_AUTO_INLINE_FALLBACK_BYTES, i, docsNeedingPrompt.length)

          if (!choice) {
            setAttachmentsForThread(attachmentsKey, (prev) =>
              prev.filter(
                (att) =>
                  !docsNeedingPrompt.some(
                    (d) => d.path && att.path && d.path === att.path
                  )
              )
            )
            return
          }
          if (doc.path) docChoices.set(doc.path, choice)
        }
      }

      const estimateTokens = async (text: string): Promise<number | undefined> => {
        try {
          if (!selectedModel?.id || !modelReady) return undefined
          const tokenCount = await serviceHub.models().getTokensCount(selectedModel.id, [
            {
              id: 'inline-attachment',
              object: 'thread.message',
              thread_id: effectiveThreadId,
              role: 'user',
              content: [{ type: ContentType.Text, text: { value: text, annotations: [] } }],
              status: MessageStatus.Ready,
              created_at: Date.now(),
              completed_at: Date.now(),
            } as ThreadMessage,
          ])
          if (typeof tokenCount !== 'number' || !Number.isFinite(tokenCount) || tokenCount <= 0) {
            return undefined
          }
          return tokenCount
        } catch (e) {
          console.debug('Failed to estimate tokens for attachment content', e)
          return undefined
        }
      }

      try {
        const { processedAttachments, hasEmbeddedDocuments } = await processAttachmentsForSend({
          attachments: docs,
          threadId: processingThreadId,
          serviceHub,
          selectedProvider,
          contextThreshold,
          estimateTokens,
          parsePreference,
          perFileChoices: docChoices.size > 0 ? docChoices : undefined,
          updateAttachmentProcessing,
        })

        console.log('[attachment-debug] processAttachmentsForSend result:', {
          count: processedAttachments.length,
          hasEmbeddedDocuments,
          items: processedAttachments.map((a) => ({
            name: a.name, processed: a.processed, injectionMode: a.injectionMode,
            hasInlineContent: !!a.inlineContent, hasId: !!a.id, error: a.error,
          })),
        })

        if (processedAttachments.length > 0) {
          setAttachmentsForThread(attachmentsKey, (prev) =>
            prev.map((att) => {
              const match = processedAttachments.find(
                (p) => p.path && att.path && p.path === att.path
              )
              return match ? { ...att, ...match } : att
            })
          )
        }

        if (hasEmbeddedDocuments && effectiveThreadId) {
          useThreads.getState().updateThread(effectiveThreadId, { metadata: { hasDocuments: true } })
        }
      } catch (e) {
        console.error('Failed to process attachments:', e)
        // Mark any still-processing attachments with error state
        const errorMsg = e instanceof Error ? e.message : 'Processing failed'
        setAttachmentsForThread(attachmentsKey, (prev) =>
          prev.map((att) => {
            if (att.type === 'document' && att.processing) {
              return { ...att, processing: false, error: errorMsg }
            }
            return att
          })
        )
      }
    },
    [
      attachmentsKey,
      autoInlineContextRatio,
      activeModels,
      effectiveThreadId,
      getProviderByName,
      parsePreference,
      selectedModel?.id,
      selectedModel?.settings?.ctx_len?.controller_props?.value,
      selectedProvider,
      serviceHub,
      setActiveModels,
      setAttachmentsForThread,
      updateAttachmentProcessing,
      updateLoadingModel,
    ]
  )

  // ─── handleAttachDocsIngest ────────────────────────────────────────────────
  const attachmentsEnabled = useAttachments((s) => s.enabled)

  const handleAttachDocsIngest = useCallback(async () => {
    try {
      if (!attachmentsEnabled) {
        toast.info('Attachments are disabled in Settings')
        return
      }

      // Check MCP availability before opening file picker
      try {
        const tools = await serviceHub.mcp().getTools()
        const hasAkidb = tools.some(
          (t) => t.name === 'fabric_ingest_run' || t.name === 'fabric_extract'
        )
        if (!hasAkidb) {
          toast.error('Document attachment requires the ax-studio MCP server', {
            description: 'Enable it in Settings → MCP Servers',
          })
          return
        }
      } catch {
        toast.error('Document attachment requires the ax-studio MCP server', {
          description: 'Enable it in Settings → MCP Servers',
        })
        return
      }

      const selection = await serviceHub.dialog().open({
        multiple: true,
        filters: [
          {
            name: 'Documents',
            extensions: ['pdf', 'docx', 'txt', 'md', 'csv', 'xlsx', 'xls', 'ods', 'pptx', 'html', 'htm'],
          },
        ],
      })
      if (!selection) return
      const paths = Array.isArray(selection) ? selection : [selection]
      if (!paths.length) return

      const preparedAttachments: Attachment[] = []
      for (const p of paths) {
        const name = p.split(/[\\/]/).pop() || p
        const fileType = name.split('.').pop()?.toLowerCase()
        let size: number | undefined = undefined
        try {
          const stat = await fs.fileStat(p)
          size = stat?.size ? Number(stat.size) : undefined
        } catch (e) {
          console.warn('Failed to read file size for', p, e)
        }
        preparedAttachments.push(createDocumentAttachment({ name, path: p, fileType, size, parseMode: parsePreference }))
      }

      const maxFileSizeBytes =
        typeof maxFileSizeMB === 'number' && maxFileSizeMB > 0
          ? maxFileSizeMB * 1024 * 1024
          : undefined

      if (maxFileSizeBytes !== undefined) {
        const hasOversized = preparedAttachments.some(
          (att) => typeof att.size === 'number' && att.size > maxFileSizeBytes
        )
        if (hasOversized) {
          toast.error('File too large', { description: `One or more files exceed the ${maxFileSizeMB}MB limit` })
          return
        }
      }

      let duplicates: string[] = []
      let newDocAttachments: Attachment[] = []

      setAttachmentsForThread(attachmentsKey, (currentAttachments) => {
        const existingPaths = new Set(
          currentAttachments.filter((a) => a.type === 'document' && a.path).map((a) => a.path)
        )
        duplicates = []
        newDocAttachments = []
        for (const att of preparedAttachments) {
          if (existingPaths.has(att.path)) { duplicates.push(att.name); continue }
          newDocAttachments.push(att)
        }
        return newDocAttachments.length > 0 ? [...currentAttachments, ...newDocAttachments] : currentAttachments
      })

      if (duplicates.length > 0) {
        toast.warning('Files already attached', {
          description: `${duplicates.join(', ')} ${duplicates.length === 1 ? 'is' : 'are'} already in the list`,
        })
      }

      if (newDocAttachments.length > 0) {
        await processNewDocumentAttachments(newDocAttachments)
      }
    } catch (e) {
      console.error('Failed to attach documents:', e)
      const desc = e instanceof Error ? e.message : JSON.stringify(e)
      toast.error('Failed to attach documents', { description: desc })
    }
  }, [
    attachmentsEnabled,
    attachmentsKey,
    maxFileSizeMB,
    parsePreference,
    processNewDocumentAttachments,
    serviceHub,
    setAttachmentsForThread,
  ])

  // ─── handleRemoveAttachment ───────────────────────────────────────────────
  const handleRemoveAttachment = useCallback(
    async (indexToRemove: number) => {
      const attachmentToRemove = attachments[indexToRemove]

      if (attachmentToRemove?.id && effectiveThreadId && attachmentToRemove.type === 'document') {
        const colId = threadCollectionId(effectiveThreadId)

        // Best-effort: delete indexed chunks from AkiDB via MCP
        try {
          // Search for all chunks belonging to this file
          const searchResult = await serviceHub.mcp().callTool({
            toolName: 'fabric_search',
            arguments: {
              query: '',
              collection_id: colId,
              top_k: 10000,
              mode: 'keyword',
              filters: { doc_id: attachmentToRemove.id },
            },
          })

          if (!searchResult.error) {
            const text = searchResult.content?.[0]?.text
            if (text) {
              try {
                const parsed = JSON.parse(text)
                const chunkIds = (parsed.results ?? [])
                  .map((r: Record<string, unknown>) => r.chunkId ?? r.chunk_id)
                  .filter(Boolean) as string[]

                if (chunkIds.length > 0) {
                  await serviceHub.mcp().callTool({
                    toolName: 'akidb_delete_chunks',
                    arguments: {
                      collection_id: colId,
                      chunk_ids: chunkIds,
                      reason: 'file_deleted',
                    },
                  })
                }
              } catch {
                // JSON parse failure — skip chunk deletion silently
              }
            }
          }
        } catch (error) {
          // AkiDB may not be running; deletion from registry still proceeds
          console.warn('Failed to delete chunks from AkiDB:', error)
        }

        // Remove from the file registry (local tracking)
        useFileRegistry.getState().removeFile(colId, attachmentToRemove.id)

        // If no files left, clear the hasDocuments flag on the thread
        if (!useFileRegistry.getState().hasFiles(colId)) {
          useThreads.getState().updateThread(effectiveThreadId, {
            metadata: { hasDocuments: false },
          })
        }
      }

      setAttachmentsForThread(attachmentsKey, (prev) =>
        prev.filter((_, index) => index !== indexToRemove)
      )
    },
    [attachments, attachmentsKey, effectiveThreadId, serviceHub, setAttachmentsForThread]
  )

  return {
    handleAttachDocsIngest,
    ingestingDocs,
    processNewDocumentAttachments,
    handleRemoveAttachment,
  }
}
