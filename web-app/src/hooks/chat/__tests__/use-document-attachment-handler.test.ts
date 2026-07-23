import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChatAttachments } from '@/hooks/chat/useChatAttachments'
import type { Attachment } from '@/types/attachment'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

const mockGetTools = vi.fn().mockResolvedValue([
  { name: 'fabric_ingest_run', server: 'ax-studio' },
  { name: 'fabric_extract', server: 'ax-studio' },
])

vi.mock('@ax-studio/core', () => ({
  ContentType: { Text: 'text' },
  MessageStatus: { Ready: 'ready' },
  fs: {
    fileStat: vi.fn().mockResolvedValue({ size: 1000 }),
  },
}))

vi.mock('@/lib/attachmentProcessing', () => ({
  processAttachmentsForSend: vi.fn().mockResolvedValue({
    processedAttachments: [],
    hasEmbeddedDocuments: false,
  }),
}))

vi.mock('@/types/attachment', () => ({
  createDocumentAttachment: vi.fn((data) => ({ ...data, type: 'document' })),
}))

let mockAttachmentsEnabled = true
let mockParsePreference: string = 'auto'
let mockMaxFileSizeMB = 50

vi.mock('@/hooks/chat/useAttachments', () => ({
  useAttachments: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      enabled: mockAttachmentsEnabled,
      parseMode: mockParsePreference,
      maxFileSizeMB: mockMaxFileSizeMB,
      autoInlineContextRatio: 0.75,
    }),
}))

let mockSelectedModel: {
  id: string
  settings?: Record<string, unknown>
} | null = {
  id: 'model-1',
}
let mockSelectedProvider = 'openai'
let mockActiveModels = ['model-1']

vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      selectedModel: mockSelectedModel,
      selectedProvider: mockSelectedProvider,
      getProviderByName: vi.fn(() => ({ provider: 'openai' })),
    }),
}))

vi.mock('@/hooks/settings/useAppState', () => ({
  useAppState: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      activeModels: mockActiveModels,
      updateLoadingModel: vi.fn(),
      setActiveModels: vi.fn(),
    }),
}))

const mockShowPrompt = vi.fn()
vi.mock('@/hooks/chat/useAttachmentIngestionPrompt', () => {
  const store = () => ({})
  store.getState = () => ({ showPrompt: mockShowPrompt })
  return { useAttachmentIngestionPrompt: store }
})

const mockUpdateThread = vi.fn()
vi.mock('@/hooks/threads/useThreads', () => {
  const store = () => ({})
  store.getState = () => ({ updateThread: mockUpdateThread })
  return { useThreads: store }
})

const mockDialogOpen = vi.fn()
const mockMcpCallTool = vi
  .fn()
  .mockResolvedValue({ error: '', content: [{ text: '{"results":[]}' }] })
const mockStartModel = vi.fn().mockResolvedValue(undefined)
const mockGetActiveModels = vi.fn().mockResolvedValue(['model-1'])
const mockGetTokensCount = vi.fn().mockResolvedValue(100)

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    dialog: () => ({ open: mockDialogOpen }),
    models: () => ({
      startModel: mockStartModel,
      getActiveModels: mockGetActiveModels,
      getTokensCount: mockGetTokensCount,
    }),
    uploads: () => ({}),
    projects: () => ({}),
    mcp: () => ({
      callTool: mockMcpCallTool,
      getTools: mockGetTools,
    }),
  }),
  getServiceHub: () => ({}),
  initializeServiceHubStore: vi.fn(),
}))

// ─── Import ───────────────────────────────────────────────────────────────────

import { useDocumentAttachmentHandler } from '../use-document-attachment-handler'
import { useFileRegistry } from '@/lib/file-registry'
import { toast } from 'sonner'
import { fs } from '@ax-studio/core'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useDocumentAttachmentHandler', () => {
  const ATTACHMENTS_KEY = 'test-thread-123'
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockAttachmentsEnabled = true
    mockParsePreference = 'auto'
    mockMaxFileSizeMB = 50
    mockSelectedModel = { id: 'model-1' }
    mockSelectedProvider = 'openai'
    mockActiveModels = ['model-1']
    mockStartModel.mockResolvedValue(undefined)
    mockGetActiveModels.mockResolvedValue(['model-1'])
    mockGetTokensCount.mockResolvedValue(100)
    mockGetTools.mockResolvedValue([
      { name: 'fabric_ingest_run', server: 'ax-studio' },
      { name: 'fabric_extract', server: 'ax-studio' },
    ])
    ;(fs.fileStat as ReturnType<typeof vi.fn>).mockResolvedValue({
      size: 1000,
    })
    // Reset the Zustand stores
    act(() => {
      useChatAttachments.setState({ attachmentsByThread: {} })
      useFileRegistry.setState({ files: {} })
    })
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  // ── Phase 1: Hook returns correct shape ──────────────────────────────────

  it('returns the expected API surface', () => {
    const { result } = renderHook(() =>
      useDocumentAttachmentHandler({
        attachmentsKey: ATTACHMENTS_KEY,
        effectiveThreadId: 'thread-1',
      })
    )

    expect(typeof result.current.handleAttachDocsIngest).toBe('function')
    expect(typeof result.current.processNewDocumentAttachments).toBe('function')
    expect(typeof result.current.handleRemoveAttachment).toBe('function')
    expect(result.current.ingestingDocs).toBe(false)
  })

  // ── Phase 2: ingestingDocs derived state ─────────────────────────────────

  it('ingestingDocs is true when any document attachment is processing', () => {
    act(() => {
      useChatAttachments
        .getState()
        .setAttachments(ATTACHMENTS_KEY, [
          { name: 'test.pdf', type: 'document', processing: true },
        ])
    })

    const { result } = renderHook(() =>
      useDocumentAttachmentHandler({
        attachmentsKey: ATTACHMENTS_KEY,
        effectiveThreadId: 'thread-1',
      })
    )

    expect(result.current.ingestingDocs).toBe(true)
  })

  it('ingestingDocs is false when no document is processing', () => {
    act(() => {
      useChatAttachments.getState().setAttachments(ATTACHMENTS_KEY, [
        { name: 'test.pdf', type: 'document', processing: false },
        { name: 'img.png', type: 'image', processing: true },
      ])
    })

    const { result } = renderHook(() =>
      useDocumentAttachmentHandler({
        attachmentsKey: ATTACHMENTS_KEY,
        effectiveThreadId: 'thread-1',
      })
    )

    expect(result.current.ingestingDocs).toBe(false)
  })

  // ── Phase 3: handleAttachDocsIngest - disabled guard ─────────────────────

  it('shows toast when attachments are disabled', async () => {
    mockAttachmentsEnabled = false
    const { result } = renderHook(() =>
      useDocumentAttachmentHandler({
        attachmentsKey: ATTACHMENTS_KEY,
        effectiveThreadId: 'thread-1',
      })
    )

    await act(async () => {
      await result.current.handleAttachDocsIngest()
    })

    expect(toast.info).toHaveBeenCalledWith(
      'Attachments are disabled in Settings'
    )
  })

  // ── Phase 4: handleAttachDocsIngest - no selection ───────────────────────

  it('returns early when dialog selection is null', async () => {
    mockDialogOpen.mockResolvedValue(null)
    const { result } = renderHook(() =>
      useDocumentAttachmentHandler({
        attachmentsKey: ATTACHMENTS_KEY,
        effectiveThreadId: 'thread-1',
      })
    )

    await act(async () => {
      await result.current.handleAttachDocsIngest()
    })

    expect(mockDialogOpen).toHaveBeenCalled()
    const attachments = useChatAttachments
      .getState()
      .getAttachments(ATTACHMENTS_KEY)
    expect(attachments).toEqual([])
  })

  // ── Phase 5: handleAttachDocsIngest - oversized file ─────────────────────

  it('shows error toast when file exceeds max size', async () => {
    mockMaxFileSizeMB = 1
    ;(fs.fileStat as ReturnType<typeof vi.fn>).mockResolvedValue({
      size: 2 * 1024 * 1024,
    })
    mockDialogOpen.mockResolvedValue(['/path/to/large.pdf'])

    const { result } = renderHook(() =>
      useDocumentAttachmentHandler({
        attachmentsKey: ATTACHMENTS_KEY,
        effectiveThreadId: 'thread-1',
      })
    )

    await act(async () => {
      await result.current.handleAttachDocsIngest()
    })

    expect(toast.error).toHaveBeenCalledWith('File too large', {
      description: 'One or more files exceed the 1MB limit',
    })
  })

  it('preserves zero byte file sizes from fileStat', async () => {
    ;(fs.fileStat as ReturnType<typeof vi.fn>).mockResolvedValue({ size: 0 })
    mockDialogOpen.mockResolvedValue(['/path/to/empty.pdf'])

    const { result } = renderHook(() =>
      useDocumentAttachmentHandler({
        attachmentsKey: ATTACHMENTS_KEY,
        effectiveThreadId: 'thread-1',
      })
    )

    await act(async () => {
      await result.current.handleAttachDocsIngest()
    })

    const { createDocumentAttachment } = await import('@/types/attachment')
    expect(createDocumentAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'empty.pdf',
        path: '/path/to/empty.pdf',
        size: 0,
      })
    )
  })

  it('does not coerce malformed fileStat sizes into attachments', async () => {
    ;(fs.fileStat as ReturnType<typeof vi.fn>).mockResolvedValue({
      size: true,
    })
    mockDialogOpen.mockResolvedValue(['/path/to/bad-size.pdf'])

    const { result } = renderHook(() =>
      useDocumentAttachmentHandler({
        attachmentsKey: ATTACHMENTS_KEY,
        effectiveThreadId: 'thread-1',
      })
    )

    await act(async () => {
      await result.current.handleAttachDocsIngest()
    })

    const { createDocumentAttachment } = await import('@/types/attachment')
    expect(createDocumentAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'bad-size.pdf',
        path: '/path/to/bad-size.pdf',
        size: undefined,
      })
    )
  })

  // ── No hard gate when AkiDB/fabric tools are missing ──────────────────────

  it('opens the file picker even when fabric_* tools are absent', async () => {
    mockGetTools.mockResolvedValue([])
    mockDialogOpen.mockResolvedValue(null)

    const { result } = renderHook(() =>
      useDocumentAttachmentHandler({
        attachmentsKey: ATTACHMENTS_KEY,
        effectiveThreadId: 'thread-1',
      })
    )

    await act(async () => {
      await result.current.handleAttachDocsIngest()
    })

    expect(mockDialogOpen).toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalledWith(
      expect.stringMatching(/AkiDB|ax-studio MCP/i),
      expect.anything()
    )
  })

  it('attaches text documents quietly when AkiDB tools are missing', async () => {
    mockGetTools.mockResolvedValue([])
    mockDialogOpen.mockResolvedValue(['/docs/notes.md'])
    ;(fs.fileStat as ReturnType<typeof vi.fn>).mockResolvedValue({
      size: 128,
    })

    const { processAttachmentsForSend } = await import(
      '@/lib/attachmentProcessing'
    )
    vi.mocked(processAttachmentsForSend).mockResolvedValueOnce({
      processedAttachments: [
        {
          name: 'notes.md',
          type: 'document',
          path: '/docs/notes.md',
          processed: true,
          injectionMode: 'inline',
          inlineContent: '# notes',
        },
      ],
      hasEmbeddedDocuments: false,
    })

    const { result } = renderHook(() =>
      useDocumentAttachmentHandler({
        attachmentsKey: ATTACHMENTS_KEY,
        effectiveThreadId: 'thread-1',
      })
    )

    await act(async () => {
      await result.current.handleAttachDocsIngest()
    })

    expect(mockShowPrompt).not.toHaveBeenCalled()
    // Text-only no-AkiDB: attach quietly — no info/error toast.
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
    expect(processAttachmentsForSend).toHaveBeenCalledWith(
      expect.objectContaining({
        parsePreference: 'inline',
        forceInline: true,
        perFileChoices: expect.any(Map),
      })
    )
    const choices = vi.mocked(processAttachmentsForSend).mock.calls[0][0]
      .perFileChoices as Map<string, string>
    expect(choices.get('/docs/notes.md')).toBe('inline')
  })

  it('skips binary documents with one warning when AkiDB is missing', async () => {
    mockGetTools.mockResolvedValue([])
    mockDialogOpen.mockResolvedValue(['/docs/report.pdf'])
    ;(fs.fileStat as ReturnType<typeof vi.fn>).mockResolvedValue({
      size: 2048,
    })

    const { processAttachmentsForSend } = await import(
      '@/lib/attachmentProcessing'
    )
    vi.mocked(processAttachmentsForSend).mockClear()

    const { result } = renderHook(() =>
      useDocumentAttachmentHandler({
        attachmentsKey: ATTACHMENTS_KEY,
        effectiveThreadId: 'thread-1',
      })
    )

    await act(async () => {
      await result.current.handleAttachDocsIngest()
    })

    // Binary never enters processAttachmentsForSend / fabric_ingest_run.
    expect(processAttachmentsForSend).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringMatching(/compatible indexer|AkiDB cannot index/i),
      expect.objectContaining({
        description: expect.stringMatching(/Settings → MCP Servers/i),
      })
    )
    expect(toast.warning).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        description: expect.not.stringMatching(/AX BI|tool toggles/i),
      })
    )
    const atts = useChatAttachments.getState().getAttachments(ATTACHMENTS_KEY)
    expect(atts.some((a) => a.error && /AkiDB|Settings/i.test(a.error))).toBe(
      true
    )
  })

  it('mixed batch without AkiDB: one summary toast, only text files processed', async () => {
    mockGetTools.mockResolvedValue([])
    mockDialogOpen.mockResolvedValue(['/docs/notes.md', '/docs/report.pdf'])
    ;(fs.fileStat as ReturnType<typeof vi.fn>).mockResolvedValue({
      size: 512,
    })

    const { processAttachmentsForSend } = await import(
      '@/lib/attachmentProcessing'
    )
    vi.mocked(processAttachmentsForSend).mockResolvedValueOnce({
      processedAttachments: [
        {
          name: 'notes.md',
          type: 'document',
          path: '/docs/notes.md',
          processed: true,
          injectionMode: 'inline',
          inlineContent: '# notes',
        },
      ],
      hasEmbeddedDocuments: false,
    })

    const { result } = renderHook(() =>
      useDocumentAttachmentHandler({
        attachmentsKey: ATTACHMENTS_KEY,
        effectiveThreadId: 'thread-1',
      })
    )

    await act(async () => {
      await result.current.handleAttachDocsIngest()
    })

    expect(processAttachmentsForSend).toHaveBeenCalledTimes(1)
    const sent = vi.mocked(processAttachmentsForSend).mock.calls[0][0]
      .attachments as Attachment[]
    expect(sent.every((a) => a.name.endsWith('.md'))).toBe(true)
    expect(sent.some((a) => a.name.endsWith('.pdf'))).toBe(false)
    expect(toast.warning).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('forceInline wins over embeddings parsePreference without AkiDB', async () => {
    mockGetTools.mockResolvedValue([])
    mockParsePreference = 'embeddings'
    mockDialogOpen.mockResolvedValue(['/docs/notes.md'])
    ;(fs.fileStat as ReturnType<typeof vi.fn>).mockResolvedValue({
      size: 128,
    })

    const { processAttachmentsForSend } = await import(
      '@/lib/attachmentProcessing'
    )
    vi.mocked(processAttachmentsForSend).mockResolvedValueOnce({
      processedAttachments: [
        {
          name: 'notes.md',
          type: 'document',
          path: '/docs/notes.md',
          processed: true,
          injectionMode: 'inline',
          inlineContent: '# notes',
        },
      ],
      hasEmbeddedDocuments: false,
    })

    const { result } = renderHook(() =>
      useDocumentAttachmentHandler({
        attachmentsKey: ATTACHMENTS_KEY,
        effectiveThreadId: 'thread-1',
      })
    )

    await act(async () => {
      await result.current.handleAttachDocsIngest()
    })

    expect(processAttachmentsForSend).toHaveBeenCalledWith(
      expect.objectContaining({
        parsePreference: 'inline',
        forceInline: true,
      })
    )
    // No parseMode on attachment that would override forceInline
    const { createDocumentAttachment } = await import('@/types/attachment')
    expect(createDocumentAttachment).toHaveBeenCalledWith(
      expect.not.objectContaining({ parseMode: 'embeddings' })
    )
  })

  // ── handleRemoveAttachment ───────────────────────────────────────────────

  it('removes attachment at specified index', async () => {
    act(() => {
      useChatAttachments.getState().setAttachments(ATTACHMENTS_KEY, [
        { name: 'a.pdf', type: 'document' },
        { name: 'b.pdf', type: 'document' },
        { name: 'c.pdf', type: 'document' },
      ])
    })

    const { result } = renderHook(() =>
      useDocumentAttachmentHandler({
        attachmentsKey: ATTACHMENTS_KEY,
        effectiveThreadId: undefined,
      })
    )

    await act(async () => {
      await result.current.handleRemoveAttachment(1)
    })

    const remaining = useChatAttachments
      .getState()
      .getAttachments(ATTACHMENTS_KEY)
    expect(remaining).toHaveLength(2)
    expect(remaining[0].name).toBe('a.pdf')
    expect(remaining[1].name).toBe('c.pdf')
  })

  // ── processNewDocumentAttachments early returns ──────────────────────────

  it('processNewDocumentAttachments returns early with empty docs', async () => {
    const { result } = renderHook(() =>
      useDocumentAttachmentHandler({
        attachmentsKey: ATTACHMENTS_KEY,
        effectiveThreadId: 'thread-1',
      })
    )

    const { processAttachmentsForSend } = await import(
      '@/lib/attachmentProcessing'
    )

    await act(async () => {
      await result.current.processNewDocumentAttachments([])
    })

    expect(processAttachmentsForSend).not.toHaveBeenCalled()
  })

  it('processNewDocumentAttachments proceeds with temporary threadId when effectiveThreadId is undefined', async () => {
    // Auto-resolve the ingestion prompt dialog (user picks 'embeddings')
    mockShowPrompt.mockResolvedValue('embeddings')

    const { result } = renderHook(() =>
      useDocumentAttachmentHandler({
        attachmentsKey: ATTACHMENTS_KEY,
        effectiveThreadId: undefined,
      })
    )

    const { processAttachmentsForSend } = await import(
      '@/lib/attachmentProcessing'
    )

    await act(async () => {
      await result.current.processNewDocumentAttachments([
        { name: 'test.pdf', type: 'document' },
      ])
    })

    // Should still be called with a temporary threadId ('__pending__')
    expect(processAttachmentsForSend).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: '__pending__',
      })
    )
  })

  it('does not block attachment processing on model readiness for embeddings choice', async () => {
    mockActiveModels = []
    mockStartModel.mockImplementation(() => new Promise(() => {}))
    mockShowPrompt.mockResolvedValue('embeddings')

    const { result } = renderHook(() =>
      useDocumentAttachmentHandler({
        attachmentsKey: ATTACHMENTS_KEY,
        effectiveThreadId: 'thread-1',
      })
    )

    const { processAttachmentsForSend } = await import(
      '@/lib/attachmentProcessing'
    )

    await act(async () => {
      await result.current.processNewDocumentAttachments([
        { name: 'test.pdf', type: 'document', path: '/tmp/test.pdf' },
      ])
    })

    expect(mockStartModel).not.toHaveBeenCalled()
    expect(processAttachmentsForSend).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        perFileChoices: expect.any(Map),
      })
    )
  })

  it('updates only the matching path when documents share a filename', async () => {
    const first = {
      name: 'report.pdf',
      type: 'document' as const,
      path: '/first/report.pdf',
      injectionMode: 'embeddings' as const,
    }
    const second = {
      name: 'report.pdf',
      type: 'document' as const,
      path: '/second/report.pdf',
      injectionMode: 'embeddings' as const,
    }
    useChatAttachments
      .getState()
      .setAttachments(ATTACHMENTS_KEY, [first, second])

    const { processAttachmentsForSend } = await import(
      '@/lib/attachmentProcessing'
    )
    vi.mocked(processAttachmentsForSend).mockImplementationOnce(
      async (options) => {
        options.updateAttachmentProcessing?.(first, 'done', {
          id: 'first-id',
        })
        return { processedAttachments: [], hasEmbeddedDocuments: false }
      }
    )
    const { result } = renderHook(() =>
      useDocumentAttachmentHandler({
        attachmentsKey: ATTACHMENTS_KEY,
        effectiveThreadId: 'thread-1',
      })
    )

    await act(async () => {
      await result.current.processNewDocumentAttachments([first])
    })

    const stored = useChatAttachments
      .getState()
      .getAttachments(ATTACHMENTS_KEY)
    expect(stored[0]).toEqual(expect.objectContaining({ id: 'first-id' }))
    expect(stored[1].id).toBeUndefined()
  })

  it('serializes document batches so a new prompt cannot cancel an older one', async () => {
    const { processAttachmentsForSend } = await import(
      '@/lib/attachmentProcessing'
    )
    let resolveFirst!: (value: {
      processedAttachments: Attachment[]
      hasEmbeddedDocuments: boolean
    }) => void
    let resolveSecond!: typeof resolveFirst
    vi.mocked(processAttachmentsForSend)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve
          })
      )
    const { result } = renderHook(() =>
      useDocumentAttachmentHandler({
        attachmentsKey: ATTACHMENTS_KEY,
        effectiveThreadId: 'thread-1',
      })
    )
    const first = {
      name: 'first.pdf',
      type: 'document' as const,
      path: '/first.pdf',
      injectionMode: 'embeddings' as const,
    }
    const second = {
      name: 'second.pdf',
      type: 'document' as const,
      path: '/second.pdf',
      injectionMode: 'embeddings' as const,
    }
    let firstRun!: Promise<void>
    let secondRun!: Promise<void>

    act(() => {
      firstRun = result.current.processNewDocumentAttachments([first])
      secondRun = result.current.processNewDocumentAttachments([second])
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(processAttachmentsForSend).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFirst({ processedAttachments: [], hasEmbeddedDocuments: false })
      await firstRun
    })
    expect(processAttachmentsForSend).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveSecond({ processedAttachments: [], hasEmbeddedDocuments: false })
      await secondRun
    })
  })

  // ── Deletion: file registry cleanup ────────────────────────────────────

  it('removes file from registry when document attachment is removed', async () => {
    mockMcpCallTool
      .mockResolvedValueOnce({
        error: '',
        content: [
          {
            text: JSON.stringify({
              results: Array.from({ length: 5 }, (_, index) => ({
                chunkId: `chunk-${index}`,
              })),
            }),
          },
        ],
      })
      .mockResolvedValueOnce({ error: '', content: [{ text: 'deleted' }] })
    // Seed file registry
    act(() => {
      useFileRegistry.getState().addFile('thread_thread-1', {
        file_id: 'file-abc',
        file_name: 'report.pdf',
        file_path: '/tmp/report.pdf',
        chunk_count: 5,
        collection_id: 'thread_thread-1',
        created_at: '2026-01-01T00:00:00Z',
      })
    })

    // Seed attachment with matching id
    act(() => {
      useChatAttachments.getState().setAttachments(ATTACHMENTS_KEY, [
        {
          name: 'report.pdf',
          type: 'document',
          id: 'file-abc',
          path: '/tmp/report.pdf',
        },
      ])
    })

    const { result } = renderHook(() =>
      useDocumentAttachmentHandler({
        attachmentsKey: ATTACHMENTS_KEY,
        effectiveThreadId: 'thread-1',
      })
    )

    await act(async () => {
      await result.current.handleRemoveAttachment(0)
    })

    // File should be gone from registry
    expect(
      useFileRegistry.getState().listFiles('thread_thread-1')
    ).toHaveLength(0)
    // Attachment should be gone from store
    expect(
      useChatAttachments.getState().getAttachments(ATTACHMENTS_KEY)
    ).toHaveLength(0)
  })

  it('clears hasDocuments flag when last file is removed', async () => {
    mockMcpCallTool
      .mockResolvedValueOnce({
        error: '',
        content: [
          {
            text: JSON.stringify({
              results: Array.from({ length: 3 }, (_, index) => ({
                chunkId: `chunk-${index}`,
              })),
            }),
          },
        ],
      })
      .mockResolvedValueOnce({ error: '', content: [{ text: 'deleted' }] })
    act(() => {
      useFileRegistry.getState().addFile('thread_thread-1', {
        file_id: 'only-file',
        file_name: 'doc.pdf',
        file_path: '/tmp/doc.pdf',
        chunk_count: 3,
        collection_id: 'thread_thread-1',
        created_at: '2026-01-01T00:00:00Z',
      })
      useChatAttachments
        .getState()
        .setAttachments(ATTACHMENTS_KEY, [
          { name: 'doc.pdf', type: 'document', id: 'only-file' },
        ])
    })

    const { result } = renderHook(() =>
      useDocumentAttachmentHandler({
        attachmentsKey: ATTACHMENTS_KEY,
        effectiveThreadId: 'thread-1',
      })
    )

    await act(async () => {
      await result.current.handleRemoveAttachment(0)
    })

    expect(useFileRegistry.getState().hasFiles('thread_thread-1')).toBe(false)
    expect(mockUpdateThread).toHaveBeenCalledWith('thread-1', {
      metadata: { hasDocuments: false },
    })
  })

  it('attempts to delete chunks from AkiDB when removing indexed document', async () => {
    // Set up a search result with chunks
    mockMcpCallTool
      .mockResolvedValueOnce({
        error: '',
        content: [
          {
            text: JSON.stringify({
              results: [{ chunkId: 'c1' }, { chunkId: 'c2' }],
            }),
          },
        ],
      })
      .mockResolvedValueOnce({
        error: '',
        content: [{ text: 'deleted' }],
      })

    act(() => {
      useFileRegistry.getState().addFile('thread_thread-1', {
        file_id: 'indexed-file',
        file_name: 'indexed.pdf',
        file_path: '/tmp/indexed.pdf',
        chunk_count: 2,
        collection_id: 'thread_thread-1',
        created_at: '2026-01-01T00:00:00Z',
      })
      useChatAttachments
        .getState()
        .setAttachments(ATTACHMENTS_KEY, [
          { name: 'indexed.pdf', type: 'document', id: 'indexed-file' },
        ])
    })

    const { result } = renderHook(() =>
      useDocumentAttachmentHandler({
        attachmentsKey: ATTACHMENTS_KEY,
        effectiveThreadId: 'thread-1',
      })
    )

    await act(async () => {
      await result.current.handleRemoveAttachment(0)
    })

    // Should have called fabric_search then akidb_delete_chunks
    expect(mockMcpCallTool).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'fabric_search',
        arguments: expect.objectContaining({
          collection_id: 'thread_thread-1',
          filters: { doc_id: 'indexed-file' },
        }),
      })
    )
    expect(mockMcpCallTool).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'akidb_delete_chunks',
        arguments: expect.objectContaining({
          collection_id: 'thread_thread-1',
          chunk_ids: ['c1', 'c2'],
          reason: 'file_deleted',
        }),
      })
    )
  })

  it('keeps the attachment tracked when AkiDB deletion fails', async () => {
    mockMcpCallTool.mockRejectedValueOnce(new Error('MCP unavailable'))

    act(() => {
      useFileRegistry.getState().addFile('thread_thread-1', {
        file_id: 'fail-file',
        file_name: 'fail.pdf',
        file_path: '/tmp/fail.pdf',
        chunk_count: 1,
        collection_id: 'thread_thread-1',
        created_at: '2026-01-01T00:00:00Z',
      })
      useChatAttachments
        .getState()
        .setAttachments(ATTACHMENTS_KEY, [
          { name: 'fail.pdf', type: 'document', id: 'fail-file' },
        ])
    })

    const { result } = renderHook(() =>
      useDocumentAttachmentHandler({
        attachmentsKey: ATTACHMENTS_KEY,
        effectiveThreadId: 'thread-1',
      })
    )

    await act(async () => {
      await result.current.handleRemoveAttachment(0)
    })

    expect(useFileRegistry.getState().hasFiles('thread_thread-1')).toBe(true)
    expect(
      useChatAttachments.getState().getAttachments(ATTACHMENTS_KEY)
    ).toHaveLength(1)
    expect(toast.error).toHaveBeenCalledWith(
      'Failed to remove indexed attachment',
      expect.any(Object)
    )
  })

  it('does not call akidb_delete_chunks when fabric_search returns isError with parseable results', async () => {
    // isError failure that still carries JSON results — must NOT delete those chunks
    mockMcpCallTool.mockResolvedValueOnce({
      error: '',
      isError: true,
      content: [
        {
          text: JSON.stringify({
            results: [{ chunkId: 'should-not-delete-1' }, { chunkId: 'should-not-delete-2' }],
          }),
        },
      ],
    })

    act(() => {
      useFileRegistry.getState().addFile('thread_thread-1', {
        file_id: 'iserror-file',
        file_name: 'iserror.pdf',
        file_path: '/tmp/iserror.pdf',
        chunk_count: 2,
        collection_id: 'thread_thread-1',
        created_at: '2026-01-01T00:00:00Z',
      })
      useChatAttachments.getState().setAttachments(ATTACHMENTS_KEY, [
        { name: 'iserror.pdf', type: 'document', id: 'iserror-file' },
      ])
    })

    const { result } = renderHook(() =>
      useDocumentAttachmentHandler({
        attachmentsKey: ATTACHMENTS_KEY,
        effectiveThreadId: 'thread-1',
      })
    )

    await act(async () => {
      await result.current.handleRemoveAttachment(0)
    })

    expect(mockMcpCallTool).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'fabric_search' })
    )
    expect(mockMcpCallTool).not.toHaveBeenCalledWith(
      expect.objectContaining({ toolName: 'akidb_delete_chunks' })
    )
    // Failed search leaves local tracking intact so deletion can be retried.
    expect(useFileRegistry.getState().hasFiles('thread_thread-1')).toBe(true)
    expect(
      useChatAttachments.getState().getAttachments(ATTACHMENTS_KEY)
    ).toHaveLength(1)
  })
})
