/**
 * useDockFileDrop — routes OS file-open requests (macOS Dock drop,
 * Windows "Open with") into the new-thread attachment pipeline.
 *
 * Paths arrive via the `dock-file-drop` Tauri event (warm) or the
 * `take_pending_open_files` command drain (cold start) in
 * GlobalEventHandler, and are written to the NEW_THREAD_ATTACHMENT_KEY
 * bucket after navigating home. Images reuse `processImageFiles`,
 * documents reuse `createDocumentAttachment` + `processNewDocumentAttachments`
 * with the same size cap and dedupe rules as the picker flow.
 */
import { useCallback, useRef } from 'react'
import { fs } from '@ax-studio/core'
import { toast } from 'sonner'
import {
  SUPPORTED_DOCUMENT_EXTENSIONS,
  SUPPORTED_IMAGE_EXTENSIONS,
} from '@/constants/attachments'
import { useDocumentAttachmentHandler } from '@/hooks/chat/use-document-attachment-handler'
import { useImageAttachmentHandler } from '@/hooks/chat/use-image-attachment-handler'
import {
  useChatAttachments,
  NEW_THREAD_ATTACHMENT_KEY,
} from '@/hooks/chat/useChatAttachments'
import { useAttachments } from '@/hooks/chat/useAttachments'
import {
  createDocumentAttachment,
  type Attachment,
} from '@/types/attachment'
import { partitionDuplicateAttachments } from '@/lib/attachments/dedupe'
import { normalizeFileSize } from '@/lib/attachments/size'
import { basename, fileExtension } from '@/lib/utils'
import { extractErrorMessage } from '@/lib/utils/error'

export function useDockFileDrop() {
  const attachmentsKey = NEW_THREAD_ATTACHMENT_KEY
  const maxFileSizeMB = useAttachments((s) => s.maxFileSizeMB)
  const setAttachmentsForThread = useChatAttachments(
    (state) => state.setAttachments
  )

  const { processNewDocumentAttachments } = useDocumentAttachmentHandler({
    attachmentsKey,
    effectiveThreadId: undefined,
  })

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  // OS-opened files target a new thread whose model capabilities are not
  // resolved here; processImageFiles re-validates type/size anyway. Its
  // message channel (oversized/invalid files) surfaces as a toast because
  // there is no composer `setMessage` at this level.
  const setMessage = useCallback((msg: string) => {
    if (msg) toast.warning(msg)
  }, [])
  const { processImageFiles } = useImageAttachmentHandler({
    attachmentsKey,
    effectiveThreadId: undefined,
    fileInputRef,
    textareaRef,
    hasMmproj: true,
    setMessage,
  })

  const handleDockFilePaths = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return

      const imagePaths: string[] = []
      const docPaths: string[] = []
      const skipped: string[] = []
      for (const p of paths) {
        const ext = fileExtension(p)
        if (SUPPORTED_IMAGE_EXTENSIONS.includes(ext)) {
          imagePaths.push(p)
        } else if (SUPPORTED_DOCUMENT_EXTENSIONS.includes(ext)) {
          docPaths.push(p)
        } else {
          skipped.push(basename(p) || p)
        }
      }

      if (skipped.length > 0) {
        toast.warning('Some files cannot be attached', {
          description: `Unsupported file type: ${skipped.join(', ')}`,
        })
      }

      // ─── Images: Tauri path → File → standard image pipeline ──────────
      if (imagePaths.length > 0) {
        const files: File[] = []
        for (const path of imagePaths) {
          try {
            const { convertFileSrc } = await import('@tauri-apps/api/core')
            const response = await fetch(convertFileSrc(path))
            if (!response.ok) {
              throw new Error(`Failed to fetch file: ${response.statusText}`)
            }
            const blob = await response.blob()
            files.push(
              new File([blob], basename(path) || 'image', { type: blob.type })
            )
          } catch (error) {
            console.error('Failed to read file:', error)
            toast.error('Failed to read file', {
              description: extractErrorMessage(error, String(error)),
            })
          }
        }
        if (files.length > 0) {
          await processImageFiles(files)
        }
      }

      // ─── Documents: same prep as handleAttachDocsIngest (stat, size cap,
      // dedupe) then the standard ingestion pipeline ─────────────────────
      if (docPaths.length > 0) {
        const preparedAttachments: Attachment[] = []
        for (const p of docPaths) {
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
              // Omit parseMode so no-AkiDB forceInline cannot be overridden by
              // a user embeddings preference (same as file-picker attach path).
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
      }
    },
    [
      attachmentsKey,
      maxFileSizeMB,
      setAttachmentsForThread,
      processImageFiles,
      processNewDocumentAttachments,
    ]
  )

  return { handleDockFilePaths }
}
