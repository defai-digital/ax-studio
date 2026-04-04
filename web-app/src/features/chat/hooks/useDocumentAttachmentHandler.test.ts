import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChatAttachments } from '@/features/chat/hooks/useChatAttachments'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

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

vi.mock('@/features/chat/hooks/useAttachments', () => ({
  useAttachments: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      enabled: mockAttachmentsEnabled,
      parseMode: mockParsePreference,
      maxFileSizeMB: mockMaxFileSizeMB,
      autoInlineContextRatio: 0.75,
    }),
}))

let mockSelectedModel: { id: string; settings?: Record<string, unknown> } | null = {
  id: 'model-1',
}
let mockSelectedProvider = 'openai'

vi.mock('@/features/models/hooks/useModelProvider', () => ({
  useModelProvider: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      selectedModel: mockSelectedModel,
      selectedProvider: mockSelectedProvider,
      getProviderByName: vi.fn(() => ({ provider: 'openai' })),
    }),
}))

vi.mock('@/hooks/useAppState', () => ({
  useAppState: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      activeModels: ['model-1'],
      updateLoadingModel: vi.fn(),
      setActiveModels: vi.fn(),
    }),
}))

const mockShowPrompt = vi.fn()
vi.mock('@/features/chat/hooks/useAttachmentIngestionPrompt', () => {
  const store = () => ({})
  store.getState = () => ({ showPrompt: mockShowPrompt })
  return { useAttachmentIngestionPrompt: store }
})

const mockUpdateThread = vi.fn()
vi.mock('@/features/threads/hooks/useThreads', () => {
  const store = () => ({})
  store.getState = () => ({ updateThread: mockUpdateThread })
  return { useThreads: store }
})

const mockDialogOpen = vi.fn()
const mockMcpCallTool = vi.fn().mockResolvedValue({ error: '', content: [{ text: '{"results":[]}' }] })

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    dialog: () => ({ open: mockDialogOpen }),
    models: () => ({
      startModel: vi.fn().mockResolvedValue(undefined),
      getActiveModels: vi.fn().mockResolvedValue(['model-1']),
      getTokensCount: vi.fn().mockResolvedValue(100),
    }),
    uploads: () => ({}),
    projects: () => ({}),
    mcp: () => ({
      callTool: mockMcpCallTool,
      getTools: vi.fn().mockResolvedValue([
        { name: 'fabric_ingest_run', server: 'ax-studio' },
        { name: 'fabric_extract', server: 'ax-studio' },
      ]),
    }),
  }),
  getServiceHub: () => ({}),
  initializeServiceHubStore: vi.fn(),
  isServiceHubInitialized: () => true,
}))

// ─── Import ───────────────────────────────────────────────────────────────────

import { useDocumentAttachmentHandler } from './useDocumentAttachmentHandler'
import { useFileRegistry } from '@/lib/file-registry'
import { toast } from 'sonner'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useDocumentAttachmentHandler', () => {
  const ATTACHMENTS_KEY = 'test-thread-123'

  beforeEach(() => {
    vi.clearAllMocks()
    mockAttachmentsEnabled = true
    mockParsePreference = 'auto'
    mockMaxFileSizeMB = 50
    mockSelectedModel = { id: 'model-1' }
    mockSelectedProvider = 'openai'
    // Reset the Zustand stores
    act(() => {
      useChatAttachments.setState({ attachmentsByThread: {} })
      useFileRegistry.setState({ files: {} })
    })
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
      useChatAttachments.getState().setAttachments(ATTACHMENTS_KEY, [
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

    expect(toast.info).toHaveBeenCalledWith('Attachments are disabled in Settings')
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
    const attachments = useChatAttachments.getState().getAttachments(ATTACHMENTS_KEY)
    expect(attachments).toEqual([])
  })

  // ── Phase 5: handleAttachDocsIngest - oversized file ─────────────────────

  it('shows error toast when file exceeds max size', async () => {
    mockMaxFileSizeMB = 1
    const { fs } = await import('@ax-studio/core')
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

    const remaining = useChatAttachments.getState().getAttachments(ATTACHMENTS_KEY)
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

    const { processAttachmentsForSend } = await import('@/lib/attachmentProcessing')

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

    const { processAttachmentsForSend } = await import('@/lib/attachmentProcessing')

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

  // ── Deletion: file registry cleanup ────────────────────────────────────

  it('removes file from registry when document attachment is removed', async () => {
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
        { name: 'report.pdf', type: 'document', id: 'file-abc', path: '/tmp/report.pdf' },
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
    expect(useFileRegistry.getState().listFiles('thread_thread-1')).toHaveLength(0)
    // Attachment should be gone from store
    expect(useChatAttachments.getState().getAttachments(ATTACHMENTS_KEY)).toHaveLength(0)
  })

  it('clears hasDocuments flag when last file is removed', async () => {
    act(() => {
      useFileRegistry.getState().addFile('thread_thread-1', {
        file_id: 'only-file',
        file_name: 'doc.pdf',
        file_path: '/tmp/doc.pdf',
        chunk_count: 3,
        collection_id: 'thread_thread-1',
        created_at: '2026-01-01T00:00:00Z',
      })
      useChatAttachments.getState().setAttachments(ATTACHMENTS_KEY, [
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
    mockMcpCallTool.mockResolvedValueOnce({
      error: '',
      content: [{ text: JSON.stringify({ results: [
        { chunkId: 'c1' },
        { chunkId: 'c2' },
      ] }) }],
    }).mockResolvedValueOnce({
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
      useChatAttachments.getState().setAttachments(ATTACHMENTS_KEY, [
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

  it('still removes from registry even if AkiDB call fails', async () => {
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
      useChatAttachments.getState().setAttachments(ATTACHMENTS_KEY, [
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

    // Registry should still be cleaned up despite MCP failure
    expect(useFileRegistry.getState().hasFiles('thread_thread-1')).toBe(false)
    expect(useChatAttachments.getState().getAttachments(ATTACHMENTS_KEY)).toHaveLength(0)
  })
})
