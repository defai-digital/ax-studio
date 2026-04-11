import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mocks ---

const {
  mockAddLocalDownloadingModel,
  mockRemoveLocalDownloadingModel,
  mockPullModelWithMetadata,
  mockToastError,
  mockGetProviderByName,
} = vi.hoisted(() => ({
  mockAddLocalDownloadingModel: vi.fn(),
  mockRemoveLocalDownloadingModel: vi.fn(),
  mockPullModelWithMetadata: vi.fn(),
  mockToastError: vi.fn(),
  mockGetProviderByName: vi.fn(),
}))

vi.mock('@/hooks/models/useDownloadStore', () => ({
  useDownloadStore: vi.fn((selector) => {
    const state = {
      downloads: {},
      localDownloadingModels: new Set<string>(),
      addLocalDownloadingModel: mockAddLocalDownloadingModel,
      removeLocalDownloadingModel: mockRemoveLocalDownloadingModel,
    }
    return typeof selector === 'function' ? selector(state) : state
  }),
}))

vi.mock('@/hooks/settings/useGeneralSetting', () => ({
  useGeneralSetting: vi.fn((selector) =>
    selector({ huggingfaceToken: 'hf-test-token' })
  ),
}))

vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: vi.fn((selector) =>
    selector({ getProviderByName: mockGetProviderByName })
  ),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    models: () => ({
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

vi.mock('@ax-studio/core', () => ({
  DownloadEvent: {
    onFileDownloadAndVerificationSuccess:
      'onFileDownloadAndVerificationSuccess',
  },
  AppEvent: {
    onModelImported: 'onModelImported',
  },
  events: {
    on: vi.fn(),
    off: vi.fn(),
  },
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
}))

import { DownloadButtonPlaceholder } from '../DownloadButton'
import { useDownloadStore } from '@/hooks/models/useDownloadStore'

describe('DownloadButtonPlaceholder', () => {
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
    mockGetProviderByName.mockReturnValue({ models: [] })
    mockPullModelWithMetadata.mockResolvedValue(undefined)
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

  it('renders "New Chat" button when model is downloaded', () => {
    mockGetProviderByName.mockReturnValue({
      models: [{ id: 'test-model-q4_k_m' }],
    })

    render(
      <DownloadButtonPlaceholder
        model={baseModel}
        handleUseModel={handleUseModel}
      />
    )

    expect(screen.getByText('hub:newChat')).toBeInTheDocument()
  })

  it('calls handleUseModel with modelId when "New Chat" is clicked', () => {
    mockGetProviderByName.mockReturnValue({
      models: [{ id: 'test-model-q4_k_m' }],
    })

    render(
      <DownloadButtonPlaceholder
        model={baseModel}
        handleUseModel={handleUseModel}
      />
    )

    fireEvent.click(screen.getByText('hub:newChat'))
    expect(handleUseModel).toHaveBeenCalledWith('test-model-q4_k_m')
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
  })

  it('hides download button when downloading', () => {
    vi.mocked(useDownloadStore).mockImplementation((selector: unknown) => {
      const state = {
        downloads: {},
        localDownloadingModels: new Set(['test-model-q4_k_m']),
        addLocalDownloadingModel: mockAddLocalDownloadingModel,
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
    expect(mockAddLocalDownloadingModel).toHaveBeenCalledWith(
      'test-model-q4_k_m'
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
    expect(mockAddLocalDownloadingModel).toHaveBeenCalledWith('test-model-fp16')
  })

  it('removes local downloading state and shows an error when the download fails to start', async () => {
    mockPullModelWithMetadata.mockRejectedValueOnce(new Error('IPC unavailable'))

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
})
