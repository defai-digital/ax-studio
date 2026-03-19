import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChatAttachments } from '@/hooks/useChatAttachments'

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
  ExtensionTypeEnum: { VectorDB: 'vector-db' },
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

vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: () => ({
      get: vi.fn().mockReturnValue(undefined),
    }),
  },
}))

vi.mock('@/types/attachment', () => ({
  createDocumentAttachment: vi.fn((data) => ({ ...data, type: 'document' })),
}))

let mockAttachmentsEnabled = true
let mockParsePreference: string = 'auto'
let mockMaxFileSizeMB = 50

vi.mock('@/hooks/useAttachments', () => ({
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

vi.mock('@/hooks/useModelProvider', () => ({
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
vi.mock('@/hooks/useAttachmentIngestionPrompt', () => {
  const store = () => ({})
  store.getState = () => ({ showPrompt: mockShowPrompt })
  return { useAttachmentIngestionPrompt: store }
})

const mockUpdateThread = vi.fn()
vi.mock('@/hooks/useThreads', () => {
  const store = () => ({})
  store.getState = () => ({ updateThread: mockUpdateThread })
  return { useThreads: store }
})

const mockDialogOpen = vi.fn()

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
  }),
  getServiceHub: () => ({}),
  initializeServiceHubStore: vi.fn(),
  isServiceHubInitialized: () => true,
}))

// ─── Import ───────────────────────────────────────────────────────────────────

import { useDocumentAttachmentHandler } from '../use-document-attachment-handler'
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
    // Reset the Zustand store
    act(() => {
      useChatAttachments.setState({ attachmentsByThread: {} })
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

  it('processNewDocumentAttachments returns early with no effectiveThreadId', async () => {
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

    expect(processAttachmentsForSend).not.toHaveBeenCalled()
  })
})
