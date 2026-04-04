import { describe, it, expect, vi, beforeEach } from 'vitest'

// We need to access the non-exported formatAttachmentError via processAttachmentsForSend,
// but we can also test processAttachmentsForSend with mocks.
// Since formatAttachmentError is not exported, we test it indirectly through error paths.

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
  },
}))

import {
  processAttachmentsForSend,
  type AttachmentProcessingResult,
} from './attachmentProcessing'
import type { Attachment } from '@/types/attachment'

// Helper to create a minimal mock ServiceHub
function createMockServiceHub(overrides: Record<string, unknown> = {}) {
  return {
    uploads: () => ({
      ingestImage: vi.fn().mockResolvedValue({ id: 'img-1' }),
      ingestFileAttachment: vi.fn().mockResolvedValue({ id: 'doc-1', size: 100, chunkCount: 5 }),
      ingestFileAttachmentForProject: vi.fn().mockResolvedValue({ id: 'proj-doc-1', size: 200, chunkCount: 10 }),
      ...overrides.uploads as object,
    }),
    rag: () => ({
      parseDocument: vi.fn().mockResolvedValue('parsed content here'),
      ...overrides.rag as object,
    }),
  } as never
}

describe('processAttachmentsForSend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty arrays when no attachments are provided', async () => {
    const result = await processAttachmentsForSend({
      attachments: [],
      threadId: 'thread-1',
      serviceHub: createMockServiceHub(),
      parsePreference: 'auto',
    })

    expect(result.processedAttachments).toEqual([])
    expect(result.hasEmbeddedDocuments).toBe(false)
  })

  it('skips already-processed images with an id', async () => {
    const img: Attachment = {
      name: 'test.png',
      type: 'image',
      processed: true,
      id: 'existing-id',
    }

    const result = await processAttachmentsForSend({
      attachments: [img],
      threadId: 'thread-1',
      serviceHub: createMockServiceHub(),
      parsePreference: 'auto',
    })

    expect(result.processedAttachments).toHaveLength(1)
    expect(result.processedAttachments[0].id).toBe('existing-id')
  })

  it('ingests new images and marks them processed', async () => {
    const img: Attachment = {
      name: 'new.png',
      type: 'image',
      base64: 'abc',
    }

    const updateFn = vi.fn()
    const result = await processAttachmentsForSend({
      attachments: [img],
      threadId: 'thread-1',
      serviceHub: createMockServiceHub(),
      parsePreference: 'auto',
      updateAttachmentProcessing: updateFn,
    })

    expect(result.processedAttachments).toHaveLength(1)
    expect(result.processedAttachments[0].id).toBe('img-1')
    expect(result.processedAttachments[0].processed).toBe(true)
    expect(result.processedAttachments[0].processing).toBe(false)

    // Should have been called with 'processing' then 'done'
    expect(updateFn).toHaveBeenCalledWith('new.png', 'processing')
    expect(updateFn).toHaveBeenCalledWith('new.png', 'done', expect.objectContaining({
      id: 'img-1',
      processed: true,
    }))
  })

  it('throws and calls update with error when image ingestion fails', async () => {
    const img: Attachment = {
      name: 'fail.png',
      type: 'image',
    }

    const updateFn = vi.fn()
    const failHub = createMockServiceHub({
      uploads: {
        ingestImage: vi.fn().mockRejectedValue(new Error('upload failed')),
      },
    })

    await expect(
      processAttachmentsForSend({
        attachments: [img],
        threadId: 'thread-1',
        serviceHub: failHub,
        parsePreference: 'auto',
        updateAttachmentProcessing: updateFn,
      })
    ).rejects.toThrow('upload failed')

    expect(updateFn).toHaveBeenCalledWith('fail.png', 'error')
  })

  it('skips already-processed documents with inline injection mode', async () => {
    const doc: Attachment = {
      name: 'doc.txt',
      type: 'document',
      processed: true,
      injectionMode: 'inline',
    }

    const result = await processAttachmentsForSend({
      attachments: [doc],
      threadId: 'thread-1',
      serviceHub: createMockServiceHub(),
      parsePreference: 'auto',
    })

    expect(result.processedAttachments).toHaveLength(1)
    expect(result.hasEmbeddedDocuments).toBe(false)
  })

  it('marks hasEmbeddedDocuments true for processed docs with embeddings', async () => {
    const doc: Attachment = {
      name: 'doc.txt',
      type: 'document',
      processed: true,
      id: 'doc-existing',
      injectionMode: 'embeddings',
    }

    const result = await processAttachmentsForSend({
      attachments: [doc],
      threadId: 'thread-1',
      serviceHub: createMockServiceHub(),
      parsePreference: 'auto',
    })

    expect(result.hasEmbeddedDocuments).toBe(true)
  })

  it('forces embeddings mode for project files', async () => {
    const doc: Attachment = {
      name: 'project-doc.txt',
      type: 'document',
      path: '/path/to/doc.txt',
    }

    const hub = createMockServiceHub()
    const result = await processAttachmentsForSend({
      attachments: [doc],
      threadId: 'thread-1',
      projectId: 'proj-1',
      serviceHub: hub,
      parsePreference: 'inline',
    })

    expect(result.processedAttachments).toHaveLength(1)
    expect(result.processedAttachments[0].injectionMode).toBe('embeddings')
    expect(result.hasEmbeddedDocuments).toBe(true)
  })

  it('uses inline mode when parsePreference is inline and content is available', async () => {
    const doc: Attachment = {
      name: 'inline-doc.txt',
      type: 'document',
      path: '/path/to/doc.txt',
    }

    const hub = createMockServiceHub()
    const result = await processAttachmentsForSend({
      attachments: [doc],
      threadId: 'thread-1',
      serviceHub: hub,
      parsePreference: 'inline',
    })

    expect(result.processedAttachments).toHaveLength(1)
    expect(result.processedAttachments[0].injectionMode).toBe('inline')
    expect(result.processedAttachments[0].inlineContent).toBe('parsed content here')
    expect(result.hasEmbeddedDocuments).toBe(false)
  })

  it('falls back to embeddings when inline parsing fails', async () => {
    const doc: Attachment = {
      name: 'fallback-doc.txt',
      type: 'document',
      path: '/path/to/doc.txt',
    }

    const hub = createMockServiceHub({
      rag: {
        parseDocument: vi.fn().mockRejectedValue(new Error('parse error')),
      },
    })
    const result = await processAttachmentsForSend({
      attachments: [doc],
      threadId: 'thread-1',
      serviceHub: hub,
      parsePreference: 'inline',
    })

    // Falls back to embeddings since parsedContent is undefined
    expect(result.processedAttachments).toHaveLength(1)
    expect(result.processedAttachments[0].injectionMode).toBe('embeddings')
    expect(result.hasEmbeddedDocuments).toBe(true)
  })

  it('uses auto mode with token estimation to decide inline vs embeddings', async () => {
    const doc: Attachment = {
      name: 'auto-doc.txt',
      type: 'document',
      path: '/path/to/doc.txt',
    }

    const hub = createMockServiceHub()
    const estimateTokens = vi.fn().mockResolvedValue(50)

    const result = await processAttachmentsForSend({
      attachments: [doc],
      threadId: 'thread-1',
      serviceHub: hub,
      parsePreference: 'auto',
      contextThreshold: 1000,
      estimateTokens,
    })

    // 50 tokens < 1000 threshold => inline
    expect(result.processedAttachments[0].injectionMode).toBe('inline')
  })

  it('uses embeddings when token count exceeds threshold in auto mode', async () => {
    const doc: Attachment = {
      name: 'large-doc.txt',
      type: 'document',
      path: '/path/to/doc.txt',
    }

    const hub = createMockServiceHub()
    const estimateTokens = vi.fn().mockResolvedValue(5000)

    const result = await processAttachmentsForSend({
      attachments: [doc],
      threadId: 'thread-1',
      serviceHub: hub,
      parsePreference: 'auto',
      contextThreshold: 1000,
      estimateTokens,
    })

    expect(result.processedAttachments[0].injectionMode).toBe('embeddings')
    expect(result.hasEmbeddedDocuments).toBe(true)
  })

  it('respects perFileChoices in auto mode', async () => {
    const doc: Attachment = {
      name: 'choice-doc.txt',
      type: 'document',
      path: '/path/to/doc.txt',
    }

    const hub = createMockServiceHub()
    const perFileChoices = new Map<string, 'inline' | 'embeddings'>()
    perFileChoices.set('/path/to/doc.txt', 'inline')

    const result = await processAttachmentsForSend({
      attachments: [doc],
      threadId: 'thread-1',
      serviceHub: hub,
      parsePreference: 'auto',
      perFileChoices,
    })

    expect(result.processedAttachments[0].injectionMode).toBe('inline')
  })

  it('handles invalid contextThreshold by treating it as undefined', async () => {
    const doc: Attachment = {
      name: 'doc.txt',
      type: 'document',
      path: '/path/to/doc.txt',
    }

    const hub = createMockServiceHub()
    const estimateTokens = vi.fn().mockResolvedValue(50)

    // contextThreshold = -1 is invalid, should be treated as undefined
    const result = await processAttachmentsForSend({
      attachments: [doc],
      threadId: 'thread-1',
      serviceHub: hub,
      parsePreference: 'auto',
      contextThreshold: -1,
      estimateTokens,
      autoFallbackMode: 'embeddings',
    })

    // Without valid threshold, defaults to autoFallbackMode
    expect(result.processedAttachments[0].injectionMode).toBe('embeddings')
  })

  it('handles prompt parsePreference with perFileChoices', async () => {
    const doc: Attachment = {
      name: 'prompt-doc.txt',
      type: 'document',
      path: '/path/to/doc.txt',
    }

    const hub = createMockServiceHub()
    const perFileChoices = new Map<string, 'inline' | 'embeddings'>()
    perFileChoices.set('/path/to/doc.txt', 'inline')

    const result = await processAttachmentsForSend({
      attachments: [doc],
      threadId: 'thread-1',
      serviceHub: hub,
      parsePreference: 'prompt',
      perFileChoices,
    })

    expect(result.processedAttachments[0].injectionMode).toBe('inline')
  })

  it('throws when document ingestion fails', async () => {
    const doc: Attachment = {
      name: 'fail-doc.txt',
      type: 'document',
      path: '/path/to/doc.txt',
    }

    const updateFn = vi.fn()
    const failHub = createMockServiceHub({
      uploads: {
        ingestFileAttachment: vi.fn().mockRejectedValue(new Error('ingest failed')),
      },
      rag: {
        parseDocument: vi.fn().mockRejectedValue(new Error('parse error')),
      },
    })

    await expect(
      processAttachmentsForSend({
        attachments: [doc],
        threadId: 'thread-1',
        serviceHub: failHub,
        parsePreference: 'embeddings',
        updateAttachmentProcessing: updateFn,
      })
    ).rejects.toThrow('ingest failed')

    expect(updateFn).toHaveBeenCalledWith('fail-doc.txt', 'error')
  })

  it('processes mixed images and documents together', async () => {
    const img: Attachment = { name: 'photo.png', type: 'image' }
    const doc: Attachment = { name: 'file.txt', type: 'document', path: '/file.txt' }

    const hub = createMockServiceHub()
    const result = await processAttachmentsForSend({
      attachments: [img, doc],
      threadId: 'thread-1',
      serviceHub: hub,
      parsePreference: 'embeddings',
    })

    expect(result.processedAttachments).toHaveLength(2)
    expect(result.processedAttachments[0].type).toBe('image')
    expect(result.processedAttachments[1].type).toBe('document')
  })
})
