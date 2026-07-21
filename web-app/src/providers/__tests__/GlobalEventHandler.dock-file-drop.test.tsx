import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GlobalEventHandler } from '../GlobalEventHandler'
import {
  useChatAttachments,
  NEW_THREAD_ATTACHMENT_KEY,
} from '@/hooks/chat/useChatAttachments'

const {
  tauriEventHandlers,
  eventHandlers,
  mockEvents,
  mockNavigate,
  mockCoreInvoke,
  mockFileStat,
  mockConvertFileSrc,
  mockProcessImageFiles,
  mockProcessNewDocumentAttachments,
  mockToastWarning,
  mockToastError,
} = vi.hoisted(() => {
  const tauriEventHandlers = new Map<string, (event: { payload: unknown }) => void>()
  const eventHandlers = new Map<string, Set<(payload?: any) => void>>()

  return {
    tauriEventHandlers,
    eventHandlers,
    mockEvents: {
      on: vi.fn((event: string, handler: (payload?: any) => void) => {
        if (!eventHandlers.has(event)) {
          eventHandlers.set(event, new Set())
        }
        eventHandlers.get(event)?.add(handler)
      }),
      off: vi.fn((event: string, handler: (payload?: any) => void) => {
        eventHandlers.get(event)?.delete(handler)
      }),
    },
    mockNavigate: vi.fn(),
    mockCoreInvoke: vi.fn(),
    mockFileStat: vi.fn(),
    mockConvertFileSrc: vi.fn((path: string) => `asset://localhost/${path}`),
    mockProcessImageFiles: vi.fn(),
    mockProcessNewDocumentAttachments: vi.fn(),
    mockToastWarning: vi.fn(),
    mockToastError: vi.fn(),
  }
})

vi.mock('@ax-studio/core', () => ({
  events: mockEvents,
  fs: {
    fileStat: mockFileStat,
  },
  ModelEvent: {
    OnModelReady: 'OnModelReady',
    OnModelStopped: 'OnModelStopped',
    OnModelFail: 'OnModelFail',
  },
  AppEvent: {
    onModelImported: 'onModelImported',
    onShowToast: 'onShowToast',
  },
  DownloadEvent: {
    onModelValidationFailed: 'onModelValidationFailed',
    onFileDownloadUpdate: 'onFileDownloadUpdate',
    onFileDownloadSuccess: 'onFileDownloadSuccess',
    onFileDownloadError: 'onFileDownloadError',
    onFileDownloadStopped: 'onFileDownloadStopped',
    onFileDownloadStarted: 'onFileDownloadStarted',
    onFileDownloadAndVerificationSuccess: 'onFileDownloadAndVerificationSuccess',
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: mockConvertFileSrc,
}))

vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: () => ({
    setProviders: vi.fn(),
  }),
}))

vi.mock('@/hooks/settings/useAppState', () => ({
  useAppState: (selector: (state: { setActiveModels: () => void }) => unknown) =>
    selector({ setActiveModels: vi.fn() }),
}))

vi.mock('@/hooks/models/useDownloadStore', () => ({
  useDownloadStore: () => ({
    updateProgress: vi.fn(),
    removeDownload: vi.fn(),
    removeLocalDownloadingModel: vi.fn(),
  }),
}))

vi.mock('@/lib/models/auto-select-downloaded-model', () => ({
  autoSelectDownloadedModel: vi.fn().mockResolvedValue({
    status: 'selected',
    showFirstModelToast: false,
  }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    providers: () => ({
      getProviders: vi.fn().mockResolvedValue([]),
    }),
    models: () => ({
      getActiveModels: vi.fn().mockResolvedValue([]),
    }),
    core: () => ({
      invoke: mockCoreInvoke,
    }),
    path: () => ({
      sep: () => '/',
    }),
    globalShortcut: () => ({
      remap: vi.fn().mockResolvedValue(undefined),
    }),
    events: () => ({
      listen: vi.fn((event: string, handler: (event: { payload: unknown }) => void) => {
        tauriEventHandlers.set(event, handler)
        return Promise.resolve(vi.fn())
      }),
    }),
  }),
}))

vi.mock('@/hooks/chat/use-document-attachment-handler', () => ({
  useDocumentAttachmentHandler: () => ({
    handleAttachDocsIngest: vi.fn(),
    ingestingDocs: false,
    processNewDocumentAttachments: mockProcessNewDocumentAttachments,
    handleRemoveAttachment: vi.fn(),
  }),
}))

vi.mock('@/hooks/chat/use-image-attachment-handler', () => ({
  useImageAttachmentHandler: () => ({
    processImageFiles: mockProcessImageFiles,
  }),
}))

vi.mock('@/hooks/chat/useAttachments', () => ({
  useAttachments: (
    selector: (state: {
      enabled: boolean
      maxFileSizeMB: number
      parseMode: 'auto'
    }) => unknown
  ) => selector({ enabled: true, maxFileSizeMB: 20, parseMode: 'auto' }),
}))

vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: () => true,
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    error: mockToastError,
    info: vi.fn(),
    success: vi.fn(),
    warning: mockToastWarning,
  },
}))

function emitDockFileDrop(paths: string[]) {
  tauriEventHandlers.get('dock-file-drop')?.({ payload: paths })
}

describe('GlobalEventHandler — dock file drop', () => {
  beforeEach(() => {
    tauriEventHandlers.clear()
    eventHandlers.clear()
    vi.clearAllMocks()
    useChatAttachments.setState({ attachmentsByThread: {} })
    mockCoreInvoke.mockResolvedValue([])
    mockFileStat.mockResolvedValue({ size: 1024 })
  })

  it('navigates home and attaches documents to a new chat on dock-file-drop', async () => {
    render(<GlobalEventHandler />)

    await waitFor(() => {
      expect(tauriEventHandlers.has('dock-file-drop')).toBe(true)
    })

    emitDockFileDrop(['/tmp/notes.pdf'])

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/' })
      const attachments = useChatAttachments
        .getState()
        .getAttachments(NEW_THREAD_ATTACHMENT_KEY)
      expect(attachments).toHaveLength(1)
      expect(attachments[0]).toMatchObject({
        name: 'notes.pdf',
        path: '/tmp/notes.pdf',
        type: 'document',
        fileType: 'pdf',
        size: 1024,
      })
    })

    expect(mockProcessNewDocumentAttachments).toHaveBeenCalledWith([
      expect.objectContaining({ path: '/tmp/notes.pdf' }),
    ])
  })

  it('drains cold-start pending open files once on mount', async () => {
    mockCoreInvoke.mockResolvedValue(['/tmp/readme.md'])

    render(<GlobalEventHandler />)

    await waitFor(() => {
      expect(mockCoreInvoke).toHaveBeenCalledWith('take_pending_open_files')
    })

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: '/' })
      const attachments = useChatAttachments
        .getState()
        .getAttachments(NEW_THREAD_ATTACHMENT_KEY)
      expect(attachments).toHaveLength(1)
      expect(attachments[0]).toMatchObject({
        name: 'readme.md',
        path: '/tmp/readme.md',
        type: 'document',
      })
    })
  })

  it('routes image paths through the image pipeline as File objects', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['fake-image'], { type: 'image/png' }),
    })
    vi.stubGlobal('fetch', mockFetch)

    try {
      render(<GlobalEventHandler />)

      await waitFor(() => {
        expect(tauriEventHandlers.has('dock-file-drop')).toBe(true)
      })

      emitDockFileDrop(['/tmp/pic.png'])

      await waitFor(() => {
        expect(mockProcessImageFiles).toHaveBeenCalledTimes(1)
      })

      const files = mockProcessImageFiles.mock.calls[0][0] as File[]
      expect(files).toHaveLength(1)
      expect(files[0]).toBeInstanceOf(File)
      expect(files[0].name).toBe('pic.png')
      expect(mockConvertFileSrc).toHaveBeenCalledWith('/tmp/pic.png')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('warns and skips files that are not attachable', async () => {
    render(<GlobalEventHandler />)

    await waitFor(() => {
      expect(tauriEventHandlers.has('dock-file-drop')).toBe(true)
    })

    emitDockFileDrop(['/tmp/installer.exe'])

    await waitFor(() => {
      expect(mockToastWarning).toHaveBeenCalledWith(
        'Some files cannot be attached',
        expect.objectContaining({
          description: expect.stringContaining('installer.exe'),
        })
      )
    })

    expect(
      useChatAttachments.getState().getAttachments(NEW_THREAD_ATTACHMENT_KEY)
    ).toHaveLength(0)
    expect(mockProcessImageFiles).not.toHaveBeenCalled()
    expect(mockProcessNewDocumentAttachments).not.toHaveBeenCalled()
  })

  it('reports failures from the OS-open attachment pipeline', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    mockProcessNewDocumentAttachments.mockRejectedValueOnce(
      new Error('ingestion unavailable')
    )
    render(<GlobalEventHandler />)

    await waitFor(() => {
      expect(tauriEventHandlers.has('dock-file-drop')).toBe(true)
    })
    emitDockFileDrop(['/tmp/notes.pdf'])

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        'Failed to attach opened files',
        { description: 'ingestion unavailable' }
      )
    })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[GlobalEventHandler] Failed to attach files opened by the OS:',
      expect.any(Error)
    )
    consoleErrorSpy.mockRestore()
  })
})
