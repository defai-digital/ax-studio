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
import { SUPPORTED_DOCUMENT_EXTENSIONS } from '@/constants/attachments'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { useAppState } from '@/hooks/settings/useAppState'
import { useAttachments } from '@/hooks/chat/useAttachments'
import { useChatAttachments } from '@/hooks/chat/useChatAttachments'
import { useAttachmentIngestionPrompt } from '@/hooks/chat/useAttachmentIngestionPrompt'
import { useThreads } from '@/hooks/threads/useThreads'
import { processAttachmentsForSend } from '@/lib/attachmentProcessing'
import { useFileRegistry, threadCollectionId } from '@/lib/file-registry'
import { createDocumentAttachment, type Attachment } from '@/types/attachment'
import { getModelContextLength } from '@/lib/models'
import {
  isSameAttachment,
  partitionDuplicateAttachments,
} from '@/lib/attachments/dedupe'
import { normalizeFileSize } from '@/lib/attachments/size'
import { extractErrorMessage } from '@/lib/utils/error'
import { basename, fileExtension } from '@/lib/utils'
import { withTimeout } from '@/lib/utils/async'
import { deleteIndexedFileChunks } from '@/lib/attachments/delete-indexed-file'
import { hasAkidbIngestOrExtractTools } from '@/lib/attachments/akidb-tools'
import { isLocallyReadableDocument } from '@/lib/attachments/local-parse'

const ATTACHMENT_AUTO_INLINE_FALLBACK_BYTES = 512 * 1024
const ATTACHMENT_MODEL_READY_TIMEOUT_MS = 5_000

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

export function useDocumentAttachmentHandler({
  attachmentsKey,
  effectiveThreadId,
}: Input): Result {
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
    useCallback(
      (state) => state.getAttachments(attachmentsKey),
      [attachmentsKey]
    )
  )
  const setAttachmentsForThread = useChatAttachments(
    (state) => state.setAttachments
  )
  const clearAttachmentsForThread = useChatAttachments(
    (state) => state.clearAttachments
  )

  // Derived
  const ingestingDocs = attachments.some(
    (a) => a.type === 'document' && a.processing
  )

  // ─── updateAttachmentProcessing ───────────────────────────────────────────
  // Internal helper — updates processing status across all matching keys
  const attachmentsKeyRef = useRef(attachmentsKey)
  attachmentsKeyRef.current = attachmentsKey

  const updateAttachmentProcessing = useCallback(
    (
      targetAttachment: Attachment,
      status: 'processing' | 'done' | 'error' | 'clear_all',
      updatedAttachment?: Partial<Attachment>
    ) => {
      const targetKey = attachmentsKeyRef.current
      const storeState = useChatAttachments.getState()

      const allMatchingKeys = Object.entries(storeState.attachmentsByThread)
        .filter(([, list]) =>
          list?.some((att) => isSameAttachment(att, targetAttachment))
        )
        .map(([key]) => key)

      const keysToUpdate = new Set([targetKey, ...allMatchingKeys])

      const applyUpdate = (key: string) => {
        if (status === 'clear_all') {
          clearAttachmentsForThread(key)
          return
        }
        setAttachmentsForThread(key, (prev) =>
          prev.map((att) =>
            isSameAttachment(att, targetAttachment)
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
  const processDocumentBatch = useCallback(
    async (docs: Attachment[]) => {
      if (!docs.length) return

      setAttachmentsForThread(attachmentsKey, (prev) =>
        prev.map((att) => {
          const isTarget = docs.some(
            (d) => d.path && att.path && d.path === att.path
          )
          return isTarget ? { ...att, processing: true } : att
        })
      )

      const processingThreadId = effectiveThreadId || '__pending__'

      let modelReadyPromise: Promise<boolean> | undefined
      const getModelReady = () => {
        modelReadyPromise ??= (async () => {
          if (!selectedModel?.id) return false
          if (activeModels.includes(selectedModel.id)) return true
          const provider = getProviderByName(selectedProvider)
          if (!provider) return false
          try {
            updateLoadingModel(true)
            await withTimeout(
              serviceHub.models().startModel(provider, selectedModel.id),
              ATTACHMENT_MODEL_READY_TIMEOUT_MS,
              'Timed out while preparing model for attachment token estimation'
            )
            const active = await withTimeout(
              serviceHub.models().getActiveModels(),
              ATTACHMENT_MODEL_READY_TIMEOUT_MS,
              'Timed out while checking active models for attachment token estimation'
            )
            setActiveModels(active || [])
            return active?.includes(selectedModel.id) ?? false
          } catch (err) {
            console.warn(
              'Failed to prepare model for attachment token estimation',
              err
            )
            return false
          } finally {
            updateLoadingModel(false)
          }
        })()
        return modelReadyPromise
      }

      const modelContextLength = getModelContextLength(
        selectedModel ?? undefined
      )

      const rawContextThreshold =
        typeof modelContextLength === 'number' && modelContextLength > 0
          ? Math.floor(
              modelContextLength *
                (typeof autoInlineContextRatio === 'number'
                  ? autoInlineContextRatio
                  : 0.75)
            )
          : undefined

      const contextThreshold =
        typeof rawContextThreshold === 'number' &&
        Number.isFinite(rawContextThreshold) &&
        rawContextThreshold > 0
          ? rawContextThreshold
          : undefined

      // Always ask the user how to process each document (inline vs embeddings)
      // when AkiDB tools are available. Without fabric_ingest/fabric_extract
      // (standard install after unpublished preset removal), force inline so
      // attach still works via local text parse / fabric-free path.
      const docsNeedingPrompt = docs.filter((doc) => {
        return !doc.processed && !doc.injectionMode
      })

      const docChoices = new Map<string, 'inline' | 'embeddings'>()

      let akidbAvailable = false
      try {
        const tools = await serviceHub.mcp().getTools()
        akidbAvailable = hasAkidbIngestOrExtractTools(tools)
      } catch {
        akidbAvailable = false
      }

      // When AkiDB is unavailable, split by local readability: text → inline,
      // binary → skip embeddings path entirely (never fabric_ingest_run).
      let docsToProcess = docs
      const BINARY_SKIP_MESSAGE =
        'PDF/DOCX and other binary documents need the AkiDB MCP server for reading — see Settings → MCP Servers.'

      if (docsNeedingPrompt.length > 0) {
        if (!akidbAvailable) {
          const readable: Attachment[] = []
          const binary: Attachment[] = []
          for (const doc of docsNeedingPrompt) {
            const typeOrPath = doc.fileType || doc.path || doc.name
            if (isLocallyReadableDocument(typeOrPath)) {
              readable.push(doc)
              if (doc.path) docChoices.set(doc.path, 'inline')
            } else {
              binary.push(doc)
            }
          }
          // Only process readable + already-processed docs; binaries never
          // enter processAttachmentsForSend / fabric_ingest_run.
          const alreadyReady = docs.filter(
            (doc) => doc.processed || doc.injectionMode
          )
          docsToProcess = [...alreadyReady, ...readable]

          if (binary.length > 0) {
            setAttachmentsForThread(attachmentsKey, (prev) =>
              prev.map((att) => {
                const match = binary.find(
                  (b) => b.path && att.path && b.path === att.path
                )
                if (!match) return att
                return {
                  ...att,
                  processing: false,
                  processed: false,
                  error: BINARY_SKIP_MESSAGE,
                }
              })
            )
          }

          // At most one summary toast per batch — never info+error pair.
          if (readable.length > 0 && binary.length > 0) {
            toast.warning('Some documents could not be attached', {
              description: `${readable.length} text file${readable.length === 1 ? '' : 's'} attached. ${binary.length} binary file${binary.length === 1 ? '' : 's'} skipped — ${BINARY_SKIP_MESSAGE}`,
            })
          } else if (binary.length > 0) {
            toast.warning('Documents need AkiDB', {
              description: BINARY_SKIP_MESSAGE,
            })
          }
          // Text-only with no AkiDB: attach quietly (no toast).
        } else {
          for (let i = 0; i < docsNeedingPrompt.length; i++) {
            const doc = docsNeedingPrompt[i]
            const choice = await useAttachmentIngestionPrompt
              .getState()
              .showPrompt(
                doc,
                ATTACHMENT_AUTO_INLINE_FALLBACK_BYTES,
                i,
                docsNeedingPrompt.length
              )

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
      }

      const estimateTokens = async (
        text: string
      ): Promise<number | undefined> => {
        try {
          if (!selectedModel?.id) return undefined
          const modelReady = await getModelReady()
          if (!modelReady) return undefined
          const tokenCount = await serviceHub
            .models()
            .getTokensCount(selectedModel.id, [
              {
                id: 'inline-attachment',
                object: 'thread.message',
                thread_id: effectiveThreadId,
                role: 'user',
                content: [
                  {
                    type: ContentType.Text,
                    text: { value: text, annotations: [] },
                  },
                ],
                status: MessageStatus.Ready,
                created_at: Date.now(),
                completed_at: Date.now(),
              } as ThreadMessage,
            ])
          if (
            typeof tokenCount !== 'number' ||
            !Number.isFinite(tokenCount) ||
            tokenCount <= 0
          ) {
            return undefined
          }
          return tokenCount
        } catch (e) {
          console.debug('Failed to estimate tokens for attachment content', e)
          return undefined
        }
      }

      if (docsToProcess.length === 0) {
        return
      }

      try {
        const { processedAttachments, hasEmbeddedDocuments } =
          await processAttachmentsForSend({
            attachments: docsToProcess,
            threadId: processingThreadId,
            serviceHub,
            selectedProvider,
            contextThreshold,
            estimateTokens,
            // Without AkiDB tools, force inline so settings set to "embeddings"
            // do not route every file into a failing fabric_ingest_run call.
            parsePreference: akidbAvailable ? parsePreference : 'inline',
            // forceInline wins over any doc-level parseMode (precedence fix).
            forceInline: !akidbAvailable,
            perFileChoices: docChoices.size > 0 ? docChoices : undefined,
            updateAttachmentProcessing,
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
          const current = useThreads.getState().threads[effectiveThreadId]
          useThreads.getState().updateThread(effectiveThreadId, {
            metadata: { ...(current?.metadata ?? {}), hasDocuments: true },
          })
        }
      } catch (e) {
        console.error('Failed to process attachments:', e)
        // Mark any still-processing attachments with error state
        const errorMsg = extractErrorMessage(e, 'Processing failed')
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
      selectedModel,
      selectedProvider,
      serviceHub,
      setActiveModels,
      setAttachmentsForThread,
      updateAttachmentProcessing,
      updateLoadingModel,
    ]
  )

  // The ingestion prompt is singleton UI. Serialize batches so a second file
  // selection cannot replace the first prompt and strand the first batch in a
  // permanent processing state.
  const documentQueueRef = useRef<Promise<void>>(Promise.resolve())
  const processNewDocumentAttachments = useCallback(
    (docs: Attachment[]): Promise<void> => {
      if (!docs.length) return Promise.resolve()

      const queued = documentQueueRef.current
        .catch(() => undefined)
        .then(() => processDocumentBatch(docs))
      documentQueueRef.current = queued.catch(() => undefined)
      return queued
    },
    [processDocumentBatch]
  )

  // ─── handleAttachDocsIngest ────────────────────────────────────────────────
  const attachmentsEnabled = useAttachments((s) => s.enabled)

  const handleAttachDocsIngest = useCallback(async () => {
    try {
      if (!attachmentsEnabled) {
        toast.info('Attachments are disabled in Settings')
        return
      }

      // Do not hard-block the file picker when AkiDB/fabric tools are missing.
      // Processing falls back to inline local parse for text documents; binary
      // types that need fabric_extract surface a per-file error after selection.

      const selection = await serviceHub.dialog().open({
        multiple: true,
        filters: [
          {
            name: 'Documents',
            extensions: SUPPORTED_DOCUMENT_EXTENSIONS,
          },
        ],
      })
      if (!selection) return
      const paths = Array.isArray(selection) ? selection : [selection]
      if (!paths.length) return

      const preparedAttachments: Attachment[] = []
      for (const p of paths) {
        const name = basename(p) || p
        const fileType = fileExtension(name)
        let size: number | undefined = undefined
        try {
          const stat = await fs.fileStat(p)
          size = normalizeFileSize(stat?.size)
        } catch (e) {
          console.warn('Failed to read file size for', p, e)
        }
        preparedAttachments.push(
          createDocumentAttachment({
            name,
            path: p,
            fileType,
            size,
            // Omit parseMode on this path so forced-inline (no AkiDB) cannot
            // be overridden by a user embeddings preference (UXQ-011).
            // processAttachmentsForSend uses forceInline / parsePreference.
          })
        )
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
          toast.error('File too large', {
            description: `One or more files exceed the ${maxFileSizeMB}MB limit`,
          })
          return
        }
      }

      let duplicates: string[] = []
      let newDocAttachments: Attachment[] = []

      setAttachmentsForThread(attachmentsKey, (currentAttachments) => {
        const result = partitionDuplicateAttachments({
          existingItems: currentAttachments,
          incomingItems: preparedAttachments,
          getExistingIdentity: (attachment) =>
            attachment.type === 'document' ? attachment.path : undefined,
          getIncomingIdentity: (attachment) => attachment.path,
          getDuplicateLabel: (attachment) => attachment.name,
        })
        duplicates = result.duplicateLabels
        newDocAttachments = result.newItems
        return newDocAttachments.length > 0
          ? [...currentAttachments, ...newDocAttachments]
          : currentAttachments
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
      const desc = extractErrorMessage(e, String(e))
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

      if (
        attachmentToRemove?.id &&
        effectiveThreadId &&
        attachmentToRemove.type === 'document'
      ) {
        const colId = threadCollectionId(effectiveThreadId)
        const registry = useFileRegistry.getState()
        const registryEntry =
          registry.getFile(colId, attachmentToRemove.id) ??
          registry
            .listFiles(colId)
            .find((file) => file.file_path === attachmentToRemove.path)
        try {
          await deleteIndexedFileChunks(serviceHub.mcp(), {
            collectionId: colId,
            documentId: registryEntry?.file_id ?? attachmentToRemove.id,
            expectedChunkCount:
              registryEntry?.chunk_count ?? attachmentToRemove.chunkCount,
          })
        } catch (error) {
          console.warn('Failed to delete chunks from AkiDB:', error)
          toast.error('Failed to remove indexed attachment', {
            description: extractErrorMessage(error, String(error)),
          })
          return
        }

        // Remove from the file registry (local tracking)
        registry.removeFile(
          colId,
          registryEntry?.file_id ?? attachmentToRemove.id
        )

        // If no files left, clear the hasDocuments flag on the thread
        if (!registry.hasFiles(colId)) {
          const threadsState = useThreads.getState()
          const current = threadsState.threads?.[effectiveThreadId]
          threadsState.updateThread(effectiveThreadId, {
            metadata: { ...(current?.metadata ?? {}), hasDocuments: false },
          })
        }
      }

      setAttachmentsForThread(attachmentsKey, (prev) =>
        prev.filter((_, index) => index !== indexToRemove)
      )
    },
    [
      attachments,
      attachmentsKey,
      effectiveThreadId,
      serviceHub,
      setAttachmentsForThread,
    ]
  )

  return {
    handleAttachDocsIngest,
    ingestingDocs,
    processNewDocumentAttachments,
    handleRemoveAttachment,
  }
}
