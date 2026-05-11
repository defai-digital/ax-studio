type AttachmentIdentity = string | null | undefined

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
  }

  return { newItems, duplicateLabels }
}
