import { describe, expect, it } from 'vitest'
import {
  getAttachmentIdentity,
  isSameAttachment,
  partitionDuplicateAttachments,
} from '../dedupe'
import type { Attachment } from '@/types/attachment'

describe('getAttachmentIdentity', () => {
  it('prefers document path over shared basenames', () => {
    expect(
      getAttachmentIdentity({
        type: 'document',
        name: 'report.pdf',
        path: '/docs/report.pdf',
      } as Attachment)
    ).toBe('document:path:/docs/report.pdf')
  })

  it('uses stable ids when present', () => {
    expect(
      getAttachmentIdentity({
        type: 'image',
        id: 'img-1',
        name: 'photo.png',
      } as Attachment)
    ).toBe('image:id:img-1')
  })

  it('falls back to image name when no id exists', () => {
    expect(
      getAttachmentIdentity({
        type: 'image',
        name: 'photo.png',
      } as Attachment)
    ).toBe('image:name:photo.png')
  })
})

describe('isSameAttachment', () => {
  it('matches documents by path even when names differ', () => {
    expect(
      isSameAttachment(
        {
          type: 'document',
          name: 'a.pdf',
          path: '/docs/a.pdf',
        } as Attachment,
        {
          type: 'document',
          name: 'a-copy.pdf',
          path: '/docs/a.pdf',
        } as Attachment
      )
    ).toBe(true)
  })

  it('does not match documents that only share a basename', () => {
    expect(
      isSameAttachment(
        {
          type: 'document',
          name: 'a.pdf',
          path: '/docs/a.pdf',
        } as Attachment,
        {
          type: 'document',
          name: 'a.pdf',
          path: '/other/a.pdf',
        } as Attachment
      )
    ).toBe(false)
  })

  it('matches images by id when available', () => {
    expect(
      isSameAttachment(
        { type: 'image', id: '1', name: 'a.png' } as Attachment,
        { type: 'image', id: '1', name: 'b.png' } as Attachment
      )
    ).toBe(true)
  })
})

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

  it('partitions duplicates within the same incoming batch', () => {
    const result = partitionDuplicateAttachments({
      existingItems: [],
      incomingItems: [
        { name: 'a.pdf', path: '/docs/a.pdf' },
        { name: 'a-again.pdf', path: '/docs/a.pdf' },
        { name: 'b.pdf', path: '/docs/b.pdf' },
      ],
      getExistingIdentity: (item) => item.path,
      getIncomingIdentity: (item) => item.path,
      getDuplicateLabel: (item) => item.name,
    })

    expect(result.newItems).toEqual([
      { name: 'a.pdf', path: '/docs/a.pdf' },
      { name: 'b.pdf', path: '/docs/b.pdf' },
    ])
    expect(result.duplicateLabels).toEqual(['a-again.pdf'])
  })
})
