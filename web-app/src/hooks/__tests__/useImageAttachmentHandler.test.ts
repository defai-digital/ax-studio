import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('sonner', () => ({
  toast: {
    warning: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: vi.fn(() => false),
}))

const mockSetAttachments = vi.fn()
vi.mock('@/hooks/useChatAttachments', () => ({
  useChatAttachments: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ setAttachments: mockSetAttachments }),
}))

const mockIngestImage = vi.fn()
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    dialog: () => ({ open: vi.fn() }),
    uploads: () => ({ ingestImage: mockIngestImage }),
  }),
  getServiceHub: () => ({}),
  initializeServiceHubStore: vi.fn(),
  isServiceHubInitialized: () => true,
}))

vi.mock('@/types/attachment', () => ({
  createImageAttachment: vi.fn((data) => ({ ...data, type: 'image' })),
}))

// ─── Import ───────────────────────────────────────────────────────────────────

import { useImageAttachmentHandler } from '../useImageAttachmentHandler'
import { toast } from 'sonner'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createFileInputRef() {
  return { current: { value: '', click: vi.fn() } as unknown as HTMLInputElement }
}

function createTextareaRef() {
  return { current: { focus: vi.fn() } as unknown as HTMLTextAreaElement }
}

function defaultParams() {
  return {
    attachmentsKey: 'thread-1',
    effectiveThreadId: 'thread-1' as string | undefined,
    fileInputRef: createFileInputRef(),
    textareaRef: createTextareaRef(),
    hasMmproj: true,
    setMessage: vi.fn(),
  }
}

function createMockFile(
  name: string,
  size: number,
  type: string
): File {
  const file = new File(['x'.repeat(Math.min(size, 100))], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useImageAttachmentHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSetAttachments.mockImplementation((_key: string, updater: unknown) => {
      if (typeof updater === 'function') {
        updater([])
      }
    })
  })

  // ── Phase 1: Hook returns expected shape ─────────────────────────────────

  it('returns the expected API surface', () => {
    const { result } = renderHook(() => useImageAttachmentHandler(defaultParams()))

    expect(typeof result.current.processImageFiles).toBe('function')
    expect(typeof result.current.handleFileChange).toBe('function')
    expect(typeof result.current.handleImagePickerClick).toBe('function')
    expect(typeof result.current.handleDragEnter).toBe('function')
    expect(typeof result.current.handleDragLeave).toBe('function')
    expect(typeof result.current.handleDragOver).toBe('function')
    expect(typeof result.current.handleDrop).toBe('function')
    expect(typeof result.current.handlePaste).toBe('function')
    expect(result.current.isDragOver).toBe(false)
  })

  // ── Phase 2: handleImagePickerClick guard ────────────────────────────────

  it('shows warning toast when hasMmproj is false', async () => {
    const params = { ...defaultParams(), hasMmproj: false }
    const { result } = renderHook(() => useImageAttachmentHandler(params))

    await act(async () => {
      await result.current.handleImagePickerClick()
    })

    expect(toast.warning).toHaveBeenCalledWith(
      'Selected model does not support image input'
    )
  })

  it('triggers file input click on web platform when hasMmproj is true', async () => {
    const params = defaultParams()
    const { result } = renderHook(() => useImageAttachmentHandler(params))

    await act(async () => {
      await result.current.handleImagePickerClick()
    })

    expect(params.fileInputRef.current!.click).toHaveBeenCalled()
  })

  // ── Phase 3: processImageFiles validation ────────────────────────────────

  it('rejects files exceeding 10MB with error message', async () => {
    const params = defaultParams()
    const { result } = renderHook(() => useImageAttachmentHandler(params))

    const oversizedFile = createMockFile('big.png', 11 * 1024 * 1024, 'image/png')

    await act(async () => {
      await result.current.processImageFiles([oversizedFile])
    })

    expect(params.setMessage).toHaveBeenCalledWith(
      expect.stringContaining('too large (max 10MB)')
    )
  })

  it('rejects files with invalid type', async () => {
    const params = defaultParams()
    const { result } = renderHook(() => useImageAttachmentHandler(params))

    const gifFile = createMockFile('anim.gif', 1000, 'image/gif')

    await act(async () => {
      await result.current.processImageFiles([gifFile])
    })

    expect(params.setMessage).toHaveBeenCalledWith(
      expect.stringContaining('Invalid file type')
    )
  })

  it('clears message when all files are valid', async () => {
    // Mock FileReader
    const originalFileReader = globalThis.FileReader
    const mockReaderInstance = {
      onload: null as (() => void) | null,
      result: 'data:image/png;base64,abc123',
      readAsDataURL: vi.fn(function (this: { onload: (() => void) | null }) {
        if (this.onload) this.onload()
      }),
    }
    globalThis.FileReader = vi.fn(
      () => mockReaderInstance
    ) as unknown as typeof FileReader

    const params = defaultParams()
    const { result } = renderHook(() => useImageAttachmentHandler(params))

    const validFile = createMockFile('photo.png', 5000, 'image/png')

    await act(async () => {
      await result.current.processImageFiles([validFile])
    })

    expect(params.setMessage).toHaveBeenCalledWith('')

    globalThis.FileReader = originalFileReader
  })

  // ── Phase 4: handleDragEnter/handleDragLeave ─────────────────────────────

  it('handleDragEnter sets isDragOver when hasMmproj is true', () => {
    const params = defaultParams()
    const { result } = renderHook(() => useImageAttachmentHandler(params))

    act(() => {
      result.current.handleDragEnter({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.DragEvent)
    })

    expect(result.current.isDragOver).toBe(true)
  })

  it('handleDragEnter does not set isDragOver when hasMmproj is false', () => {
    const params = { ...defaultParams(), hasMmproj: false }
    const { result } = renderHook(() => useImageAttachmentHandler(params))

    act(() => {
      result.current.handleDragEnter({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.DragEvent)
    })

    expect(result.current.isDragOver).toBe(false)
  })

  // ── Phase 5: handleDrop ──────────────────────────────────────────────────

  it('handleDrop resets isDragOver and does nothing when hasMmproj is false', () => {
    const params = { ...defaultParams(), hasMmproj: false }
    const { result } = renderHook(() => useImageAttachmentHandler(params))

    act(() => {
      result.current.handleDrop({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: { files: [] },
      } as unknown as React.DragEvent)
    })

    expect(result.current.isDragOver).toBe(false)
  })

  it('handleDrop warns when no dataTransfer is available', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const params = defaultParams()
    const { result } = renderHook(() => useImageAttachmentHandler(params))

    act(() => {
      result.current.handleDrop({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: null,
      } as unknown as React.DragEvent)
    })

    expect(warnSpy).toHaveBeenCalledWith(
      'No dataTransfer available in drop event'
    )
    warnSpy.mockRestore()
  })

  // ── handlePaste guard ────────────────────────────────────────────────────

  it('handlePaste does nothing when hasMmproj is false', async () => {
    const params = { ...defaultParams(), hasMmproj: false }
    const { result } = renderHook(() => useImageAttachmentHandler(params))

    const preventDefault = vi.fn()
    await act(async () => {
      await result.current.handlePaste({
        preventDefault,
        clipboardData: {
          items: [{ type: 'image/png', getAsFile: () => createMockFile('p.png', 100, 'image/png') }],
        },
      } as unknown as React.ClipboardEvent)
    })

    // Should not call preventDefault since it returns early
    expect(preventDefault).not.toHaveBeenCalled()
  })

  // ── handleFileChange ─────────────────────────────────────────────────────

  it('handleFileChange focuses textarea after processing', () => {
    const params = defaultParams()
    const { result } = renderHook(() => useImageAttachmentHandler(params))

    act(() => {
      result.current.handleFileChange({
        target: { files: null },
      } as unknown as React.ChangeEvent<HTMLInputElement>)
    })

    expect(params.textareaRef.current!.focus).toHaveBeenCalled()
  })

  // ── Combined error messages ──────────────────────────────────────────────

  it('combines oversized and invalid type errors with pipe separator', async () => {
    const params = defaultParams()
    const { result } = renderHook(() => useImageAttachmentHandler(params))

    const oversizedFile = createMockFile('big.png', 11 * 1024 * 1024, 'image/png')
    const invalidFile = createMockFile('doc.bmp', 100, 'image/bmp')

    await act(async () => {
      await result.current.processImageFiles([oversizedFile, invalidFile])
    })

    const msg = params.setMessage.mock.calls[0][0] as string
    expect(msg).toContain('too large')
    expect(msg).toContain('|')
    expect(msg).toContain('Invalid file type')
  })
})
