import type { Attachment } from '@/types/attachment'

type AttachmentIdentity = string | null | undefined

export function getAttachmentIdentity(
  attachment: Attachment
): string | undefined {
  if (attachment.type === 'document' && attachment.path) {
    return `document:path:${attachment.path}`
  }
  if (attachment.id) {
    return `${attachment.type}:id:${attachment.id}`
  }
  if (attachment.type === 'image' && attachment.name) {
    return `image:name:${attachment.name}`
  }
  return undefined
}

export function isSameAttachment(
  candidate: Attachment,
  target: Attachment
): boolean {
  if (candidate.type !== target.type) return false

  if (target.type === 'document' && (candidate.path || target.path)) {
    return Boolean(
      candidate.path && target.path && candidate.path === target.path
    )
  }
  if (candidate.id || target.id) {
    return Boolean(candidate.id && target.id && candidate.id === target.id)
  }
  return candidate.name === target.name
}

type PartitionDuplicateAttachmentsOptions<TExisting, TIncoming> = {
  existingItems: TExisting[]
  incomingItems: TIncoming[]
  getExistingIdentity: (item: TExisting) => AttachmentIdentity
  getIncomingIdentity: (item: TIncoming) => AttachmentIdentity
  getDuplicateLabel: (item: TIncoming) => string
}

export function partitionDuplicateAttachments<TExisting, TIncoming>({
  existingItems,
  incomingItems,
  getExistingIdentity,
  getIncomingIdentity,
  getDuplicateLabel,
}: PartitionDuplicateAttachmentsOptions<TExisting, TIncoming>) {
  const existingIdentities = new Set(
    existingItems
      .map(getExistingIdentity)
      .filter((identity): identity is string => Boolean(identity))
  )

  const newItems: TIncoming[] = []
  const duplicateLabels: string[] = []

  for (const item of incomingItems) {
    const identity = getIncomingIdentity(item)
    if (identity && existingIdentities.has(identity)) {
      duplicateLabels.push(getDuplicateLabel(item))
      continue
    }
    newItems.push(item)
    if (identity) {
      existingIdentities.add(identity)
    }
  }

  return { newItems, duplicateLabels }
}
