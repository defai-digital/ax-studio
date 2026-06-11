import { describe, expect, it } from 'vitest'
import { partitionDuplicateAttachments } from '../dedupe'

describe('partitionDuplicateAttachments', () => {
  it('partitions incoming image attachments by existing name', () => {
    const result = partitionDuplicateAttachments({
      existingItems: [
        { name: 'existing.png', type: 'image' },
        { name: 'notes.pdf', type: 'document' },
      ],
      incomingItems: [
        { name: 'existing.png', type: 'image' },
        { name: 'new.png', type: 'image' },
      ],
      getExistingIdentity: (item) =>
        item.type === 'image' ? item.name : undefined,
      getIncomingIdentity: (item) => item.name,
      getDuplicateLabel: (item) => item.name,
    })

    expect(result.newItems).toEqual([{ name: 'new.png', type: 'image' }])
    expect(result.duplicateLabels).toEqual(['existing.png'])
  })

  it('partitions incoming document attachments by existing path', () => {
    const result = partitionDuplicateAttachments({
      existingItems: [
        { name: 'a.pdf', path: '/docs/a.pdf' },
        { name: 'missing-path.pdf' },
      ],
      incomingItems: [
        { name: 'a-copy.pdf', path: '/docs/a.pdf' },
        { name: 'b.pdf', path: '/docs/b.pdf' },
      ],
      getExistingIdentity: (item) => item.path,
      getIncomingIdentity: (item) => item.path,
      getDuplicateLabel: (item) => item.name,
    })

    expect(result.newItems).toEqual([{ name: 'b.pdf', path: '/docs/b.pdf' }])
    expect(result.duplicateLabels).toEqual(['a-copy.pdf'])
  })

  it('keeps incoming items with no identity', () => {
    const result = partitionDuplicateAttachments({
      existingItems: [{ name: 'a.pdf', path: '/docs/a.pdf' }],
      incomingItems: [
        { name: 'unknown.pdf' },
        { name: 'a.pdf', path: '/docs/a.pdf' },
      ],
      getExistingIdentity: (item) => item.path,
      getIncomingIdentity: (item) => item.path,
      getDuplicateLabel: (item) => item.name,
    })

    expect(result.newItems).toEqual([{ name: 'unknown.pdf' }])
    expect(result.duplicateLabels).toEqual(['a.pdf'])
  })
})
