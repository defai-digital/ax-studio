import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
  },
}))

const extractDocumentText = vi.hoisted(() => vi.fn())

vi.mock('@/lib/attachments/document-extraction', () => ({
  extractDocumentText,
}))

import {
  processAttachmentsForSend,
  type AttachmentProcessingResult,
} from '../attachmentProcessing'
import type { Attachment } from '@/types/attachment'

// Helper to create a minimal mock ServiceHub: images go through
// uploads().ingestImage, documents are extracted via core (passed to
// extractDocumentText). There is no embeddings/indexing path anymore.
function createMockServiceHub(overrides: Record<string, unknown> = {}) {
  return {
    uploads: () => ({
      ingestImage: vi.fn().mockResolvedValue({ id: 'img-1' }),
      ...(overrides.uploads as object),
    }),
    core: () => overrides.core ?? { invoke: vi.fn() },
  } as never
}

function extractedText(text: string) {
  return {
    text,
    metadata: { format: 'txt', unitCount: 1, truncated: false },
    warnings: [],
  }
}

describe('processAttachmentsForSend', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    extractDocumentText.mockResolvedValue(extractedText('parsed content here'))
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
    consoleErrorSpy.mockRestore()
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

  it('always reports hasEmbeddedDocuments false (no embeddings path)', async () => {
    const doc: Attachment = {
      name: 'doc.txt',
      type: 'document',
      processed: true,
      id: 'doc-existing',
      injectionMode: 'embeddings',
    }

    const result: AttachmentProcessingResult = await processAttachmentsForSend({
      attachments: [doc],
      threadId: 'thread-1',
      serviceHub: createMockServiceHub(),
      parsePreference: 'auto',
    })

    expect(result.hasEmbeddedDocuments).toBe(false)
  })

  it('skips already-processed images with an id', async () => {
    const img: Attachment = {
      name: 'test.png',
      type: 'image',
      processed: true,
      id: 'existing-id',
    }
    const hub = createMockServiceHub()

    const result = await processAttachmentsForSend({
      attachments: [img],
      threadId: 'thread-1',
      serviceHub: hub,
      parsePreference: 'auto',
    })

    expect(result.processedAttachments).toHaveLength(1)
    expect(result.processedAttachments[0].id).toBe('existing-id')
    expect(hub.uploads().ingestImage).not.toHaveBeenCalled()
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
    expect(updateFn).toHaveBeenCalledWith(img, 'processing')
    expect(updateFn).toHaveBeenCalledWith(
      img,
      'done',
      expect.objectContaining({
        id: 'img-1',
        processed: true,
      })
    )
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

    expect(updateFn).toHaveBeenCalledWith(img, 'error')
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
    expect(extractDocumentText).not.toHaveBeenCalled()
  })

  it('always inlines documents via extractDocumentText regardless of parsePreference', async () => {
    const doc: Attachment = {
      name: 'notes.md',
      type: 'document',
      path: '/docs/notes.md',
      fileType: 'md',
      parseMode: 'embeddings',
    }
    const core = { invoke: vi.fn() }

    for (const parsePreference of ['auto', 'inline', 'embeddings'] as const) {
      extractDocumentText.mockClear()
      const result = await processAttachmentsForSend({
        attachments: [doc],
        threadId: 'thread-1',
        serviceHub: createMockServiceHub({ core }),
        parsePreference,
      })

      expect(extractDocumentText).toHaveBeenCalledWith({
        path: '/docs/notes.md',
        fileType: 'md',
        core,
      })
      expect(result.processedAttachments).toHaveLength(1)
      expect(result.processedAttachments[0]).toEqual(
        expect.objectContaining({
          injectionMode: 'inline',
          inlineContent: 'parsed content here',
          processed: true,
          processing: false,
        })
      )
      expect(result.hasEmbeddedDocuments).toBe(false)
    }
  })

  it('notifies done with the inline content when extraction succeeds', async () => {
    const doc: Attachment = {
      name: 'doc.txt',
      type: 'document',
      path: '/path/to/doc.txt',
    }
    const updateFn = vi.fn()

    await processAttachmentsForSend({
      attachments: [doc],
      threadId: 'thread-1',
      serviceHub: createMockServiceHub(),
      parsePreference: 'auto',
      updateAttachmentProcessing: updateFn,
    })

    expect(updateFn).toHaveBeenCalledWith(doc, 'processing')
    expect(updateFn).toHaveBeenCalledWith(
      doc,
      'done',
      expect.objectContaining({
        inlineContent: 'parsed content here',
        injectionMode: 'inline',
        processed: true,
      })
    )
  })

  it('marks unreadable documents as error and skips them WITHOUT throwing', async () => {
    extractDocumentText.mockRejectedValue(
      new Error('PDF contains no extractable text; scanned PDFs require OCR')
    )
    const badDoc: Attachment = {
      name: 'scan.pdf',
      type: 'document',
      path: '/docs/scan.pdf',
      fileType: 'pdf',
    }
    const goodDoc: Attachment = {
      name: 'notes.md',
      type: 'document',
      path: '/docs/notes.md',
      fileType: 'md',
    }
    const updateFn = vi.fn()

    // The batch continues: the good document after the bad one still processes.
    extractDocumentText.mockImplementation(({ path }: { path: string }) =>
      path.endsWith('.pdf')
        ? Promise.reject(new Error('scanned PDFs require OCR'))
        : Promise.resolve(extractedText('md body'))
    )

    const result = await processAttachmentsForSend({
      attachments: [badDoc, goodDoc],
      threadId: 'thread-1',
      serviceHub: createMockServiceHub(),
      parsePreference: 'auto',
      updateAttachmentProcessing: updateFn,
    })

    expect(result.processedAttachments).toHaveLength(1)
    expect(result.processedAttachments[0].name).toBe('notes.md')
    expect(updateFn).toHaveBeenCalledWith(
      badDoc,
      'error',
      expect.objectContaining({
        processing: false,
        error: expect.stringMatching(/scanned PDFs require OCR/i),
      })
    )
    expect(result.hasEmbeddedDocuments).toBe(false)
  })

  it('marks documents without a readable path as error and skips them', async () => {
    extractDocumentText.mockResolvedValue(extractedText(''))
    const doc: Attachment = {
      name: 'empty.txt',
      type: 'document',
      path: '/docs/empty.txt',
    }
    const updateFn = vi.fn()

    const result = await processAttachmentsForSend({
      attachments: [doc],
      threadId: 'thread-1',
      serviceHub: createMockServiceHub(),
      parsePreference: 'auto',
      updateAttachmentProcessing: updateFn,
    })

    expect(result.processedAttachments).toHaveLength(0)
    expect(updateFn).toHaveBeenCalledWith(
      doc,
      'error',
      expect.objectContaining({ processing: false })
    )
  })

  it('processes mixed images and documents together', async () => {
    const img: Attachment = { name: 'photo.png', type: 'image' }
    const doc: Attachment = {
      name: 'file.txt',
      type: 'document',
      path: '/file.txt',
    }

    const result = await processAttachmentsForSend({
      attachments: [img, doc],
      threadId: 'thread-1',
      serviceHub: createMockServiceHub(),
      parsePreference: 'auto',
    })

    expect(result.processedAttachments).toHaveLength(2)
    expect(result.processedAttachments[0].type).toBe('image')
    expect(result.processedAttachments[1].type).toBe('document')
    expect(result.processedAttachments[1].injectionMode).toBe('inline')
  })
})
