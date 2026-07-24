import type { Attachment } from '@/types/attachment'

export function isSendableAttachment(attachment: Attachment): boolean {
  if (attachment.processing || attachment.error) return false

  if (attachment.type === 'image') {
    return Boolean(attachment.base64 && attachment.mimeType)
  }

  if (attachment.type === 'document') {
    return (
      attachment.processed === true &&
      Boolean(attachment.inlineContent || attachment.id)
    )
  }

  return false
}

export function hasSendableAttachment(attachments: Attachment[]): boolean {
  return attachments.some(isSendableAttachment)
}
