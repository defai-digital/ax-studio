import { toast } from 'sonner'

import { extractErrorMessage, toError } from '@/lib/utils/error'
import { extractDocumentText } from '@/lib/attachments/document-extraction'

import type { ServiceHub } from '@/services'
import type { Attachment } from '@/types/attachment'

type AttachmentProcessingStatus = 'processing' | 'done' | 'error' | 'clear_all'

type AttachmentProcessingOptions = {
  attachments: Attachment[]
  threadId: string
  serviceHub: ServiceHub
  selectedProvider?: string
  contextThreshold?: number
  estimateTokens?: (text: string) => Promise<number | undefined>
  parsePreference: 'auto' | 'inline' | 'embeddings' | 'prompt'
  /**
   * Kept for call-site compatibility; documents are always inlined now that
   * the AkiDB/RAG indexing layer is gone (migration matrix §2.2).
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

export type AttachmentProcessingResult = {
  processedAttachments: Attachment[]
  hasEmbeddedDocuments: boolean
}

export const processAttachmentsForSend = async (
  options: AttachmentProcessingOptions
): Promise<AttachmentProcessingResult> => {
  const { attachments, threadId, serviceHub, updateAttachmentProcessing } =
    options

  const processedAttachments: Attachment[] = []
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

  const finishInline = (doc: Attachment, content: string) => {
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

  // Documents: always inline — extract text locally and attach it to the
  // outgoing message. There is no embeddings/vector-index path anymore.
  const documents = attachments.filter((a) => a.type === 'document')
  for (const doc of documents) {
    if (doc.processed && (doc.id || doc.injectionMode === 'inline')) {
      processedAttachments.push(doc)
      continue
    }

    notifyUpdate(doc, 'processing')

    let inlineContent: string | undefined
    let inlineParseError: string | undefined
    if (doc.path) {
      try {
        const extracted = await extractDocumentText({
          path: doc.path,
          fileType: doc.fileType,
          core: serviceHub.core(),
        })
        inlineContent = extracted.text
      } catch (parseErr) {
        inlineParseError = extractErrorMessage(
          parseErr,
          `Could not extract text from ${doc.name}`
        )
        console.warn(`[AttachProc] Failed to parse ${doc.name} inline`, parseErr)
      }
    }

    if (inlineContent) {
      finishInline(doc, inlineContent)
      continue
    }

    notifyUpdate(doc, 'error', {
      processing: false,
      error: inlineParseError ?? 'Could not read this document locally',
    })
    // Do not throw: an unreadable document must not fail the whole batch.
  }

  return { processedAttachments, hasEmbeddedDocuments: false }
}
