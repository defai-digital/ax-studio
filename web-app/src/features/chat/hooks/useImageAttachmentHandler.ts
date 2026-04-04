/**
 * useImageAttachmentHandler — encapsulates image attachment processing,
 * drag-and-drop, paste, and image picker logic for ChatInput.
 *
 * Manages `isDragOver` state internally; delegates all store mutations through
 * `setAttachmentsForThread` and calls `setMessage` to surface validation errors.
 */
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useChatAttachments } from '@/features/chat/hooks/useChatAttachments'
import { createImageAttachment, type Attachment } from '@/types/attachment'
import { isPlatformTauri } from '@/lib/platform/utils'

export type ImageAttachmentHandlerParams = {
  attachmentsKey: string
  effectiveThreadId: string | undefined
  fileInputRef: React.RefObject<HTMLInputElement | null>
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  hasMmproj: boolean
  setMessage: (msg: string) => void
}

function getFileTypeFromExtension(fileName: string): string {
  const extension = fileName.toLowerCase().split('.').pop()
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    default:
      return ''
  }
}

export function useImageAttachmentHandler({
  attachmentsKey,
  effectiveThreadId,
  fileInputRef,
  textareaRef,
  hasMmproj,
  setMessage,
}: ImageAttachmentHandlerParams) {
  const serviceHub = useServiceHub()
  const setAttachmentsForThread = useChatAttachments(
    (state) => state.setAttachments
  )

  const [isDragOver, setIsDragOver] = useState(false)

  // ─── Image file processing ──────────────────────────────────────────────────

  const processImageFiles = useCallback(
    async (files: File[]) => {
      const maxSize = 10 * 1024 * 1024 // 10MB
      const oversizedFiles: string[] = []
      const invalidTypeFiles: string[] = []
      const allowedTypes = ['image/jpg', 'image/jpeg', 'image/png']
      const validFiles: File[] = []

      Array.from(files).forEach((file) => {
        if (file.size > maxSize) {
          oversizedFiles.push(file.name)
          return
        }
        const detectedType = file.type || getFileTypeFromExtension(file.name)
        const actualType = getFileTypeFromExtension(file.name) || detectedType
        if (!allowedTypes.includes(actualType)) {
          invalidTypeFiles.push(file.name)
          return
        }
        validFiles.push(file)
      })

      const preparedFiles = await (async () => {
        const result: Attachment[] = []
        for (const file of validFiles) {
          const detectedType = file.type || getFileTypeFromExtension(file.name)
          const actualType = getFileTypeFromExtension(file.name) || detectedType
          const reader = new FileReader()
          await new Promise<void>((resolve) => {
            reader.onload = () => {
              const res = reader.result
              if (typeof res === 'string') {
                const base64String = res.split(',')[1]
                result.push(
                  createImageAttachment({
                    name: file.name,
                    size: file.size,
                    mimeType: actualType,
                    base64: base64String,
                    dataUrl: res,
                  })
                )
              }
              resolve()
            }
            reader.readAsDataURL(file)
          })
        }
        return result
      })()

      let duplicates: string[] = []
      let newFiles: Attachment[] = []

      setAttachmentsForThread(attachmentsKey, (currentAttachments) => {
        const existingImageNames = new Set(
          currentAttachments.filter((a) => a.type === 'image').map((a) => a.name)
        )
        duplicates = []
        newFiles = []
        for (const att of preparedFiles) {
          if (existingImageNames.has(att.name)) {
            duplicates.push(att.name)
            continue
          }
          newFiles.push(att)
        }
        return newFiles.length > 0
          ? [...currentAttachments, ...newFiles]
          : currentAttachments
      })

      if (effectiveThreadId && newFiles.length > 0) {
        void (async () => {
          for (const img of newFiles) {
            try {
              setAttachmentsForThread(attachmentsKey, (prev) =>
                prev.map((a) =>
                  a.name === img.name && a.type === 'image'
                    ? { ...a, processing: true }
                    : a
                )
              )
              const result = await serviceHub
                .uploads()
                .ingestImage(effectiveThreadId, img)
              if (result?.id) {
                setAttachmentsForThread(attachmentsKey, (prev) =>
                  prev.map((a) =>
                    a.name === img.name && a.type === 'image'
                      ? { ...a, processing: false, processed: true, id: result.id }
                      : a
                  )
                )
              } else {
                throw new Error('No ID returned from image ingestion')
              }
            } catch (error) {
              console.error('Failed to ingest image:', error)
              setAttachmentsForThread(attachmentsKey, (prev) =>
                prev.filter((a) => !(a.name === img.name && a.type === 'image'))
              )
              toast.error(`Failed to ingest ${img.name}`, {
                description:
                  error instanceof Error ? error.message : String(error),
              })
            }
          }
        })()
      }

      if (duplicates.length > 0) {
        toast.warning('Some images already attached', {
          description: `${duplicates.join(', ')} ${duplicates.length === 1 ? 'is' : 'are'} already in the list`,
        })
      }

      const errors: string[] = []
      if (oversizedFiles.length > 0) {
        errors.push(
          `File${oversizedFiles.length > 1 ? 's' : ''} too large (max 10MB): ${oversizedFiles.join(', ')}`
        )
      }
      if (invalidTypeFiles.length > 0) {
        errors.push(
          `Invalid file type${invalidTypeFiles.length > 1 ? 's' : ''} (only JPEG, JPG, PNG allowed): ${invalidTypeFiles.join(', ')}`
        )
      }

      if (errors.length > 0) {
        setMessage(errors.join(' | '))
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      } else {
        setMessage('')
      }
    },
    [
      attachmentsKey,
      effectiveThreadId,
      serviceHub,
      setAttachmentsForThread,
      setMessage,
      fileInputRef,
    ]
  )

  // ─── Image picker (Tauri native or web file input) ──────────────────────────

  const openImagePicker = useCallback(async () => {
    if (isPlatformTauri()) {
      try {
        const selected = await serviceHub.dialog().open({
          multiple: true,
          filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png'] }],
        })
        if (selected) {
          const paths = Array.isArray(selected) ? selected : [selected]
          const files: File[] = []
          for (const path of paths) {
            try {
              const { convertFileSrc } = await import('@tauri-apps/api/core')
              const fileUrl = convertFileSrc(path)
              const response = await fetch(fileUrl)
              if (!response.ok) {
                throw new Error(`Failed to fetch file: ${response.statusText}`)
              }
              const blob = await response.blob()
              const fileName =
                path.split(/[\\/]/).filter(Boolean).pop() || 'image'
              const ext = fileName.toLowerCase().split('.').pop()
              const mimeType =
                ext === 'png'
                  ? 'image/png'
                  : ext === 'jpg' || ext === 'jpeg'
                    ? 'image/jpeg'
                    : 'image/jpeg'
              files.push(new File([blob], fileName, { type: mimeType }))
            } catch (error) {
              console.error('Failed to read file:', error)
              toast.error('Failed to read file', {
                description:
                  error instanceof Error ? error.message : String(error),
              })
            }
          }
          if (files.length > 0) {
            await processImageFiles(files)
          }
        }
      } catch (error) {
        console.error('Failed to open file dialog:', error)
      }
      textareaRef.current?.focus()
    } else {
      fileInputRef.current?.click()
    }
  }, [serviceHub, processImageFiles, fileInputRef, textareaRef])

  // ─── File input change ──────────────────────────────────────────────────────

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files && files.length > 0) {
        void processImageFiles(Array.from(files))
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
      textareaRef.current?.focus()
    },
    [processImageFiles, fileInputRef, textareaRef]
  )

  // ─── Image picker click (with mmproj guard) ─────────────────────────────────

  const handleImagePickerClick = useCallback(async () => {
    if (hasMmproj) {
      await openImagePicker()
    } else {
      toast.warning('Selected model does not support image input')
    }
  }, [hasMmproj, openImagePicker])

  // ─── Drag and drop ──────────────────────────────────────────────────────────

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (hasMmproj) setIsDragOver(true)
    },
    [hasMmproj]
  )

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const relatedTarget = e.relatedTarget as Node | null
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setIsDragOver(false)
    }
  }, [])

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (hasMmproj) setIsDragOver(true)
    },
    [hasMmproj]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)
      if (!hasMmproj) return
      if (!e.dataTransfer) {
        console.warn('No dataTransfer available in drop event')
        return
      }
      const files = e.dataTransfer.files
      if (files && files.length > 0) {
        const syntheticEvent = {
          target: { files },
        } as React.ChangeEvent<HTMLInputElement>
        handleFileChange(syntheticEvent)
      }
    },
    [hasMmproj, handleFileChange]
  )

  // ─── Paste ──────────────────────────────────────────────────────────────────

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      if (!hasMmproj) return

      const clipboardItems = e.clipboardData?.items
      let hasProcessedImage = false

      if (clipboardItems && clipboardItems.length > 0) {
        const imageItems = Array.from(clipboardItems).filter((item) =>
          item.type.startsWith('image/')
        )
        if (imageItems.length > 0) {
          e.preventDefault()
          const files: File[] = []
          let processedCount = 0
          imageItems.forEach((item) => {
            const file = item.getAsFile()
            if (file) files.push(file)
            processedCount++
            if (processedCount === imageItems.length && files.length > 0) {
              const syntheticEvent = {
                target: { files },
              } as unknown as React.ChangeEvent<HTMLInputElement>
              handleFileChange(syntheticEvent)
              hasProcessedImage = true
            }
          })
          if (hasProcessedImage) return
        }
      }

      if (
        navigator.clipboard &&
        'read' in navigator.clipboard &&
        !hasProcessedImage
      ) {
        try {
          const clipboardContents = await navigator.clipboard.read()
          const files: File[] = []
          for (const item of clipboardContents) {
            const imageTypes = item.types.filter((type) =>
              type.startsWith('image/')
            )
            for (const type of imageTypes) {
              try {
                const blob = await item.getType(type)
                const extension = type.split('/')[1] || 'png'
                files.push(
                  new File(
                    [blob],
                    `pasted-image-${Date.now()}.${extension}`,
                    { type }
                  )
                )
              } catch (error) {
                console.error('Error reading clipboard item:', error)
              }
            }
          }
          if (files.length > 0) {
            e.preventDefault()
            const syntheticEvent = {
              target: { files },
            } as unknown as React.ChangeEvent<HTMLInputElement>
            handleFileChange(syntheticEvent)
          }
        } catch (error) {
          console.error('Clipboard API access failed:', error)
        }
      }
    },
    [hasMmproj, handleFileChange]
  )

  return {
    isDragOver,
    processImageFiles,
    handleFileChange,
    handleImagePickerClick,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handlePaste,
  }
}
