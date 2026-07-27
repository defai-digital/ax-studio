import { act, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mocks ---

const {
  mockAddLocalDownloadingModel,
  mockAbortDownload,
  mockRemoveDownload,
  mockRemoveLocalDownloadingModel,
  mockPullModelWithMetadata,
  mockToastError,
  mockProviders,
  mockIsMlxSupported,
  mockEvents,
} = vi.hoisted(() => ({
  mockAddLocalDownloadingModel: vi.fn(),
  mockAbortDownload: vi.fn(),
  mockRemoveDownload: vi.fn(),
  mockRemoveLocalDownloadingModel: vi.fn(),
  mockPullModelWithMetadata: vi.fn(),
  mockToastError: vi.fn(),
  mockProviders: { current: [] as ModelProvider[] },
  mockIsMlxSupported: vi.fn(),
  mockEvents: {
    on: vi.fn(),
    off: vi.fn(),
  },
}))

vi.mock('@/hooks/models/useDownloadStore', () => ({
  toDownloadProcesses: vi.fn(
    (
      downloads: Record<
        string,
        { name: string; progress: number; current: number; total: number }
      >
    ) =>
      Object.values(downloads).map((download) => ({
        id: download.name,
        name: download.name,
        progress: download.progress,
        current: download.current,
        total: download.total,
      }))
  ),
  useDownloadStore: vi.fn((selector) => {
    const state = {
      downloads: {},
      localDownloadingModels: new Set<string>(),
      addLocalDownloadingModel: mockAddLocalDownloadingModel,
      removeDownload: mockRemoveDownload,
      removeLocalDownloadingModel: mockRemoveLocalDownloadingModel,
    }
    return typeof selector === 'function' ? selector(state) : state
  }),
}))

vi.mock('@/hooks/models/useHuggingFaceConnection', () => ({
  useHuggingFaceConnection: vi.fn((selector) =>
    selector({ token: 'hf-test-token' })
  ),
}))

vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: vi.fn((selector) =>
    selector({ providers: mockProviders.current })
  ),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    models: () => ({
      abortDownload: mockAbortDownload,
      pullModelWithMetadata: mockPullModelWithMetadata,
    }),
  }),
}))

vi.mock('@/i18n', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    error: mockToastError,
  },
}))

vi.mock('@/lib/platform/utils', () => ({
  isMlxSupported: mockIsMlxSupported,
}))

vi.mock('@ax-studio/core', () => ({
  DownloadEvent: {
    onFileDownloadUpdate: 'onFileDownloadUpdate',
    onFileDownloadAndVerificationSuccess:
      'onFileDownloadAndVerificationSuccess',
    onFileDownloadSuccess: 'onFileDownloadSuccess',
    onFileDownloadError: 'onFileDownloadError',
    onFileDownloadStopped: 'onFileDownloadStopped',
    onFileDownloadStarted: 'onFileDownloadStarted',
  },
  AppEvent: {
    onModelImported: 'onModelImported',
  },
  events: mockEvents,
}))

vi.mock('@/constants/models', () => ({
  DEFAULT_MODEL_QUANTIZATIONS: ['iq4_xs', 'q4_k_m'],
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: {
    children: React.ReactNode
    onClick?: () => void
    [key: string]: unknown
  }) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/progress', () => ({
  Progress: ({ value }: { value: number }) => (
    <div data-testid="progress" data-value={value} />
  ),
}))

vi.mock('lucide-react', () => ({
  ExternalLink: () => <span data-testid="external-link-icon" />,
  Download: () => <span data-testid="download-icon" />,
  Pause: () => <span data-testid="pause-icon" />,
  Play: () => <span data-testid="play-icon" />,
  Loader2: () => <span data-testid="loader-icon" />,
}))

import { DownloadButtonPlaceholder } from '../DownloadButton'
import { useDownloadStore } from '@/hooks/models/useDownloadStore'

describe('DownloadButtonPlaceholder', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  const baseModel = {
    model_name: 'test-model',
    description: 'A test model',
    downloads: 100,
    developer: 'test-dev',
    quants: [
      {
        model_id: 'test-model-q4_k_m',
        path: '/path/to/model',
        file_size: '4GB',
      },
    ],
  }

  const handleUseModel = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockProviders.current = []
    mockIsMlxSupported.mockReturnValue(true)
    mockAbortDownload.mockResolvedValue(undefined)
    mockPullModelWithMetadata.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    consoleErrorSpy.mockRestore()
  })

  it('renders HuggingFace link when model has no quants', () => {
    const modelNoQuants = { ...baseModel, quants: [] }
    render(
      <DownloadButtonPlaceholder
        model={modelNoQuants}
        handleUseModel={handleUseModel}
      />
    )

    const link = screen.getByText('HuggingFace').closest('a')
    expect(link).toHaveAttribute('href', 'https://huggingface.co/test-model')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('renders HuggingFace link when quants is undefined', () => {
    const modelUndefinedQuants = { ...baseModel, quants: undefined }
    render(
      <DownloadButtonPlaceholder
        model={modelUndefinedQuants}
        handleUseModel={handleUseModel}
      />
    )

    expect(screen.getByText('HuggingFace')).toBeInTheDocument()
  })

  it('renders download button when model has quants and is not downloaded', () => {
    render(
      <DownloadButtonPlaceholder
        model={baseModel}
        handleUseModel={handleUseModel}
      />
    )

    expect(screen.getByText('hub:download')).toBeInTheDocument()
  })

  it('does not subscribe idle catalog rows to global download events', () => {
    render(
      <DownloadButtonPlaceholder
        model={baseModel}
        handleUseModel={handleUseModel}
      />
    )

    expect(mockEvents.on).not.toHaveBeenCalled()
  })

  it('starts full-repo download for MLX Hugging Face repo quants', () => {
    const mlxModel = {
      ...baseModel,
      model_name: 'mlx-community/Qwen3.5-9B-MLX-4bit',
      developer: 'mlx-community',
      is_mlx: true,
      quants: [
        {
          model_id: 'mlx-community/Qwen3.5-9B-MLX-4bit',
          path: 'hf://mlx-community/Qwen3.5-9B-MLX-4bit',
          file_size: '6GB',
        },
      ],
    }

    render(
      <DownloadButtonPlaceholder
        model={mlxModel}
        handleUseModel={handleUseModel}
      />
    )

    fireEvent.click(screen.getByText('hub:download'))
    expect(mockAddLocalDownloadingModel).toHaveBeenCalledWith(
      'mlx-community/Qwen3.5-9B-MLX-4bit'
    )
    expect(mockPullModelWithMetadata).toHaveBeenCalledWith(
      'mlx-community/Qwen3.5-9B-MLX-4bit',
      'hf://mlx-community/Qwen3.5-9B-MLX-4bit',
      undefined,
      'hf-test-token'
    )
  })

  it('blocks MLX downloads on unsupported platforms', () => {
    mockIsMlxSupported.mockReturnValue(false)
    const mlxModel = {
      ...baseModel,
      model_name: 'mlx-community/Qwen3.5-9B-MLX-4bit',
      developer: 'mlx-community',
      is_mlx: true,
      quants: [
        {
          model_id: 'mlx-community/Qwen3.5-9B-MLX-4bit',
          path: 'hf://mlx-community/Qwen3.5-9B-MLX-4bit',
          file_size: '6GB',
        },
      ],
    }

    render(
      <DownloadButtonPlaceholder
        model={mlxModel}
        handleUseModel={handleUseModel}
      />
    )

    fireEvent.click(screen.getByText('hub:download'))

    expect(mockToastError).toHaveBeenCalledWith(
      'MLX models not supported',
      expect.objectContaining({
        description: expect.stringContaining('MLX models only work on macOS'),
      })
    )
    expect(mockAddLocalDownloadingModel).not.toHaveBeenCalled()
    expect(mockPullModelWithMetadata).not.toHaveBeenCalled()
  })

  it('renders "New Chat" button when model is downloaded', () => {
    mockProviders.current = [
      {
        provider: 'llamacpp',
        models: [{ id: 'test-model-q4_k_m' }],
      } as ModelProvider,
    ]

    render(
      <DownloadButtonPlaceholder
        model={baseModel}
        handleUseModel={handleUseModel}
      />
    )

    expect(screen.getByText('hub:newChat')).toBeInTheDocument()
  })

  it('calls handleUseModel with modelId when "New Chat" is clicked', () => {
    mockProviders.current = [
      {
        provider: 'llamacpp',
        models: [{ id: 'test-model-q4_k_m' }],
      } as ModelProvider,
    ]

    render(
      <DownloadButtonPlaceholder
        model={baseModel}
        handleUseModel={handleUseModel}
      />
    )

    fireEvent.click(screen.getByText('hub:newChat'))
    expect(handleUseModel).toHaveBeenCalledWith('test-model-q4_k_m', 'llamacpp')
  })

  it('starts download when download button is clicked', () => {
    render(
      <DownloadButtonPlaceholder
        model={baseModel}
        handleUseModel={handleUseModel}
      />
    )

    fireEvent.click(screen.getByText('hub:download'))
    expect(mockAddLocalDownloadingModel).toHaveBeenCalledWith(
      'test-model-q4_k_m'
    )
    expect(mockPullModelWithMetadata).toHaveBeenCalledWith(
      'test-model-q4_k_m',
      '/path/to/model',
      undefined,
      'hf-test-token'
    )
  })

  it('shows progress bar when downloading', () => {
    vi.mocked(useDownloadStore).mockImplementation((selector: unknown) => {
      const state = {
        downloads: {
          'test-model-q4_k_m': {
            name: 'test-model-q4_k_m',
            progress: 0.5,
            current: 2000,
            total: 4000,
          },
        },
        localDownloadingModels: new Set(['test-model-q4_k_m']),
        addLocalDownloadingModel: mockAddLocalDownloadingModel,
        removeDownload: mockRemoveDownload,
        removeLocalDownloadingModel: mockRemoveLocalDownloadingModel,
      }
      return typeof selector === 'function' ? selector(state) : state
    })

    render(
      <DownloadButtonPlaceholder
        model={baseModel}
        handleUseModel={handleUseModel}
      />
    )

    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(mockEvents.on).toHaveBeenCalledTimes(7)
  })

  it('hides download button when downloading', () => {
    vi.mocked(useDownloadStore).mockImplementation((selector: unknown) => {
      const state = {
        downloads: {},
        localDownloadingModels: new Set(['test-model-q4_k_m']),
        addLocalDownloadingModel: mockAddLocalDownloadingModel,
        removeDownload: mockRemoveDownload,
        removeLocalDownloadingModel: mockRemoveLocalDownloadingModel,
      }
      return typeof selector === 'function' ? selector(state) : state
    })

    render(
      <DownloadButtonPlaceholder
        model={baseModel}
        handleUseModel={handleUseModel}
      />
    )

    const downloadButton = screen.queryByText('hub:download')
    // Button exists but has 'hidden' class
    expect(downloadButton?.closest('button')).toHaveClass('hidden')
  })

  it('selects matching quant based on DEFAULT_MODEL_QUANTIZATIONS', () => {
    const modelMultiQuants = {
      ...baseModel,
      quants: [
        { model_id: 'test-model-q8_0', path: '/path/q8', file_size: '8GB' },
        { model_id: 'test-model-q4_k_m', path: '/path/q4', file_size: '4GB' },
      ],
    }

    render(
      <DownloadButtonPlaceholder
        model={modelMultiQuants}
        handleUseModel={handleUseModel}
      />
    )

    fireEvent.click(screen.getByText('hub:download'))
    // Should match q4_k_m from DEFAULT_MODEL_QUANTIZATIONS
    expect(mockPullModelWithMetadata).toHaveBeenCalledWith(
      'test-model-q4_k_m',
      '/path/q4',
      undefined,
      'hf-test-token'
    )
  })

  it('falls back to first quant when no default quantization matches', () => {
    const modelOtherQuants = {
      ...baseModel,
      quants: [
        { model_id: 'test-model-fp16', path: '/path/fp16', file_size: '16GB' },
      ],
    }

    render(
      <DownloadButtonPlaceholder
        model={modelOtherQuants}
        handleUseModel={handleUseModel}
      />
    )

    fireEvent.click(screen.getByText('hub:download'))
    expect(mockPullModelWithMetadata).toHaveBeenCalledWith(
      'test-model-fp16',
      '/path/fp16',
      undefined,
      'hf-test-token'
    )
  })

  it('removes local downloading state and shows an error when the download fails to start', async () => {
    mockPullModelWithMetadata.mockRejectedValueOnce(
      new Error('IPC unavailable')
    )

    render(
      <DownloadButtonPlaceholder
        model={baseModel}
        handleUseModel={handleUseModel}
      />
    )

    fireEvent.click(screen.getByText('hub:download'))

    await vi.waitFor(() => {
      expect(mockRemoveLocalDownloadingModel).toHaveBeenCalledWith(
        'test-model-q4_k_m'
      )
      expect(mockToastError).toHaveBeenCalledWith(
        'Failed to start model download',
        expect.objectContaining({
          description: 'IPC unavailable',
        })
      )
    })
  })

  it('aborts an accepted download when no real progress arrives', () => {
    vi.useFakeTimers()
    mockPullModelWithMetadata.mockReturnValue(new Promise(() => {}))

    render(
      <DownloadButtonPlaceholder
        model={baseModel}
        handleUseModel={handleUseModel}
      />
    )

    fireEvent.click(screen.getByText('hub:download'))

    const startedHandler = mockEvents.on.mock.calls.find(
      ([event]) => event === 'onFileDownloadStarted'
    )?.[1] as ((state: { downloadId: string }) => void) | undefined

    expect(startedHandler).toBeDefined()

    act(() => {
      startedHandler?.({ downloadId: 'test-model-q4_k_m' })
      vi.advanceTimersByTime(120_000)
    })

    expect(mockRemoveDownload).toHaveBeenCalledWith('test-model-q4_k_m')
    expect(mockRemoveLocalDownloadingModel).toHaveBeenCalledWith(
      'test-model-q4_k_m'
    )
    expect(mockAbortDownload).toHaveBeenCalledWith('test-model-q4_k_m')
  })

  it('clears pending download watchdogs on unmount', () => {
    vi.useFakeTimers()
    mockPullModelWithMetadata.mockReturnValue(new Promise(() => {}))
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout')

    try {
      const { unmount } = render(
        <DownloadButtonPlaceholder
          model={baseModel}
          handleUseModel={handleUseModel}
        />
      )

      fireEvent.click(screen.getByText('hub:download'))
      unmount()

      expect(clearTimeoutSpy).toHaveBeenCalledTimes(2)
    } finally {
      clearTimeoutSpy.mockRestore()
    }
  })
})
