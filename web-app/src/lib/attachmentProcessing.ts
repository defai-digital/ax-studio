import { toast } from 'sonner'

import { extractErrorMessage, toError } from '@/lib/utils/error'

import type { ServiceHub } from '@/services'
import type { Attachment } from '@/types/attachment'

type AttachmentProcessingStatus = 'processing' | 'done' | 'error' | 'clear_all'
type DocumentInjectionMode = 'inline' | 'embeddings'

type AttachmentProcessingOptions = {
  attachments: Attachment[]
  threadId: string
  projectId?: string
  serviceHub: ServiceHub
  selectedProvider?: string
  contextThreshold?: number
  estimateTokens?: (text: string) => Promise<number | undefined>
  parsePreference: 'auto' | 'inline' | 'embeddings' | 'prompt'
  /**
   * When true, always use inline mode and ignore doc-level `parseMode`
   * (used for no-AkiDB forced-inline batches so user embeddings settings
   * cannot re-route into a guaranteed-failing fabric_ingest_run).
   */
  forceInline?: boolean
  autoFallbackMode?: 'inline' | 'embeddings'
  perFileChoices?: Map<string, 'inline' | 'embeddings'>
  updateAttachmentProcessing?: (
    attachment: Attachment,
    status: AttachmentProcessingStatus,
    updatedAttachment?: Partial<Attachment>
  ) => void
}

function resolveChosenDocumentMode(
  projectId: string | undefined,
  userChoice: DocumentInjectionMode | undefined,
  autoFallbackMode: DocumentInjectionMode | undefined
): DocumentInjectionMode {
  return projectId
    ? 'embeddings'
    : (userChoice ?? autoFallbackMode ?? 'embeddings')
}

export type AttachmentProcessingResult = {
  processedAttachments: Attachment[]
  hasEmbeddedDocuments: boolean
}

export const processAttachmentsForSend = async (
  options: AttachmentProcessingOptions
): Promise<AttachmentProcessingResult> => {
  const {
    attachments,
    threadId,
    projectId,
    serviceHub,
    contextThreshold,
    estimateTokens,
    parsePreference,
    forceInline = false,
    autoFallbackMode,
    perFileChoices,
    updateAttachmentProcessing,
  } = options

  const processedAttachments: Attachment[] = []
  let hasEmbeddedDocuments = false
  const effectiveContextThreshold =
    typeof contextThreshold === 'number' &&
    Number.isFinite(contextThreshold) &&
    contextThreshold > 0
      ? contextThreshold
      : undefined
  const notifyUpdate = (
    ...args: Parameters<
      NonNullable<AttachmentProcessingOptions['updateAttachmentProcessing']>
    >
  ) => updateAttachmentProcessing?.(...args)

  // Images: ingest before sending
  const images = attachments.filter((a) => a.type === 'image')
  if (images.length > 0) {
    for (const img of images) {
      try {
        if (img.processed && img.id) {
          processedAttachments.push(img)
          continue
        }

        notifyUpdate(img, 'processing')

        const res = await serviceHub.uploads().ingestImage(threadId, img)
        processedAttachments.push({
          ...img,
          id: res.id,
          processed: true,
          processing: false,
        })
        notifyUpdate(img, 'done', {
          id: res.id,
          processed: true,
          processing: false,
        })
      } catch (err) {
        console.error(`Failed to ingest image ${img.name}:`, err)
        notifyUpdate(img, 'error')
        const desc = extractErrorMessage(err, 'Unknown error')
        toast.error('Failed to ingest image attachment', { description: desc })
        throw toError(err, desc)
      }
    }
  }

  const documents = attachments.filter((a) => a.type === 'document')
  for (const doc of documents) {
    try {
      if (doc.processed && (doc.id || doc.injectionMode === 'inline')) {
        hasEmbeddedDocuments =
          hasEmbeddedDocuments || doc.injectionMode !== 'inline'
        processedAttachments.push(doc)
        continue
      }

      notifyUpdate(doc, 'processing')

      // forceInline wins over doc-level parseMode (UXQ-011 precedence fix).
      const targetPreference: AttachmentProcessingOptions['parsePreference'] =
        forceInline ? 'inline' : (doc.parseMode ?? parsePreference)
      let targetMode: DocumentInjectionMode =
        targetPreference === 'inline' ? 'inline' : 'embeddings'
      let parsedContent: string | undefined

      // Project files always use embeddings, never inline
      if (projectId) {
        targetMode = 'embeddings'
      }

      const canInline =
        !projectId && targetPreference !== 'embeddings' && !!doc.path

      if (canInline) {
        try {
          parsedContent = await serviceHub
            .rag()
            .parseDocument?.(doc.path!, doc.fileType)
        } catch (err) {
          console.warn(
            `[AttachProc] Failed to parse ${doc.name} for inline use`,
            err
          )
        }
      }

      const userChoice = perFileChoices?.get(doc.path || '')
      if (targetPreference === 'auto') {
        const effectiveMode = resolveChosenDocumentMode(
          projectId,
          userChoice,
          autoFallbackMode
        )
        targetMode = effectiveMode

        // Only do auto-detection if no user choice was made and not project file
        if (!projectId && !userChoice && parsedContent && estimateTokens) {
          const estimatedTokens = await estimateTokens(parsedContent)
          const tokenCount =
            typeof estimatedTokens === 'number' &&
            Number.isFinite(estimatedTokens) &&
            estimatedTokens > 0
              ? estimatedTokens
              : undefined
          if (!effectiveContextThreshold) {
            console.debug(
              `Attachment ${doc.name}: no context threshold available; defaulting to ${targetMode}`
            )
          } else if (typeof tokenCount === 'number') {
            targetMode =
              tokenCount <= effectiveContextThreshold ? 'inline' : 'embeddings'
          } else {
            console.debug(
              `Attachment ${doc.name}: token estimate unavailable or non-positive; defaulting to ${targetMode}`
            )
          }
        } else if (!projectId && !userChoice && !parsedContent) {
          console.debug(
            `Attachment ${doc.name}: parsed content unavailable for token estimation; defaulting to ${targetMode}`
          )
        } else if (!projectId && !userChoice) {
          console.debug(
            `Attachment ${doc.name}: token estimator unavailable; defaulting to ${targetMode}`
          )
        }
      } else if (targetPreference === 'prompt') {
        targetMode = resolveChosenDocumentMode(
          projectId,
          userChoice,
          autoFallbackMode
        )
      }

      const finishInline = (content: string) => {
        processedAttachments.push({
          ...doc,
          processing: false,
          processed: true,
          inlineContent: content,
          injectionMode: 'inline',
        })

        notifyUpdate(doc, 'done', {
          processing: false,
          processed: true,
          inlineContent: content,
          injectionMode: 'inline',
        })
      }

      if (targetMode === 'inline' && parsedContent) {
        finishInline(parsedContent)
        continue
      }

      // Default: ingest as embeddings (also recovers when inline parse failed
      // but fabric_ingest is available). When AkiDB is missing, catch falls
      // back to inline text if parseDocument can still produce content.
      notifyUpdate(doc, 'processing')

      try {
        const res = projectId
          ? await serviceHub
              .uploads()
              .ingestFileAttachmentForProject(projectId, doc)
          : await serviceHub.uploads().ingestFileAttachment(threadId, doc)

        processedAttachments.push({
          ...doc,
          id: res.id,
          size: res.size ?? doc.size,
          chunkCount: res.chunkCount ?? doc.chunkCount,
          processing: false,
          processed: true,
          injectionMode: 'embeddings',
        })
        hasEmbeddedDocuments = true

        notifyUpdate(doc, 'done', {
          id: res.id,
          size: res.size ?? doc.size,
          chunkCount: res.chunkCount ?? doc.chunkCount,
          processing: false,
          processed: true,
          injectionMode: 'embeddings',
        })
      } catch (ingestErr) {
        if (!projectId) {
          let fallbackContent = parsedContent
          if (!fallbackContent && doc.path) {
            try {
              fallbackContent = await serviceHub
                .rag()
                .parseDocument?.(doc.path, doc.fileType)
            } catch (parseErr) {
              console.warn(
                `[AttachProc] Inline fallback parse failed for ${doc.name}`,
                parseErr
              )
            }
          }
          if (fallbackContent) {
            console.info(
              `[AttachProc] Embeddings unavailable for ${doc.name}; using inline content`
            )
            finishInline(fallbackContent)
            continue
          }
        }
        throw ingestErr
      }
    } catch (err) {
      console.error(`Failed to ingest ${doc.name}:`, err)
      notifyUpdate(doc, 'error')
      const desc = extractErrorMessage(err, 'Unknown error')
      toast.error('Failed to index attachments', { description: desc })
      throw toError(err, desc)
    }
  }

  return { processedAttachments, hasEmbeddedDocuments }
}
