import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAddLocalDownloadingModel,
  mockRemoveLocalDownloadingModel,
  mockPullModelWithMetadata,
  mockNavigate,
  mockToastError,
  mockProviders,
} = vi.hoisted(() => ({
  mockAddLocalDownloadingModel: vi.fn(),
  mockRemoveLocalDownloadingModel: vi.fn(),
  mockPullModelWithMetadata: vi.fn(),
  mockNavigate: vi.fn(),
  mockToastError: vi.fn(),
  mockProviders: { current: [] as ModelProvider[] },
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
  useDownloadStore: vi.fn(() => ({
    downloads: {},
    localDownloadingModels: new Set<string>(),
    addLocalDownloadingModel: mockAddLocalDownloadingModel,
    removeLocalDownloadingModel: mockRemoveLocalDownloadingModel,
  })),
}))

vi.mock('@/hooks/settings/useGeneralSetting', () => ({
  useGeneralSetting: vi.fn((selector) =>
    selector({ huggingfaceToken: 'hf-test-token' })
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

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
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
  events: {
    on: vi.fn(),
    off: vi.fn(),
  },
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick?: () => void
  }) => <button onClick={onClick}>{children}</button>,
}))

vi.mock('@/components/ui/progress', () => ({
  Progress: ({ value }: { value: number }) => (
    <div data-testid="progress" data-value={value} />
  ),
}))

vi.mock('lucide-react', () => ({
  Download: () => <span data-testid="download-icon" />,
  ExternalLink: () => <span data-testid="external-link-icon" />,
  Loader2: () => <span data-testid="loader-icon" />,
}))

import { ModelDownloadAction } from '../ModelDownloadAction'

describe('ModelDownloadAction', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  const variant = {
    model_id: 'model-q4',
    path: '/models/model-q4.gguf',
  }

  const model = {
    developer: 'ax',
    model_name: 'Model',
    mmproj_models: [],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockProviders.current = []
    mockPullModelWithMetadata.mockResolvedValue(undefined)
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('starts a model download when clicked', () => {
    render(<ModelDownloadAction variant={variant} model={model as never} />)

    fireEvent.click(screen.getByTitle('hub:downloadModel'))

    expect(mockAddLocalDownloadingModel).toHaveBeenCalledWith('model-q4')
    expect(mockPullModelWithMetadata).toHaveBeenCalledWith(
      'model-q4',
      '/models/model-q4.gguf',
      undefined,
      'hf-test-token'
    )
  })

  it('starts full-repo download for MLX Hugging Face repo variants', () => {
    const mlxVariant = {
      model_id: 'mlx-community/Qwen3.5-9B-MLX-4bit',
      path: 'hf://mlx-community/Qwen3.5-9B-MLX-4bit',
    }
    const mlxModel = {
      ...model,
      model_name: 'mlx-community/Qwen3.5-9B-MLX-4bit',
      is_mlx: true,
    }

    render(
      <ModelDownloadAction
        variant={mlxVariant}
        model={mlxModel as never}
      />
    )

    fireEvent.click(screen.getByTitle('hub:downloadModel'))
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

  it('tracks GGUF downloads with the sanitized runtime model id', () => {
    const ggufVariant = {
      model_id: 'mradermacher/Qwen3.5-9B-heretic.Q4_K_M',
      path: 'https://huggingface.co/mradermacher/Qwen3.5-9B-heretic-GGUF/resolve/main/Qwen3.5-9B-heretic.Q4_K_M.gguf',
    }

    render(
      <ModelDownloadAction variant={ggufVariant} model={model as never} />
    )

    fireEvent.click(screen.getByTitle('hub:downloadModel'))

    expect(mockAddLocalDownloadingModel).toHaveBeenCalledWith(
      'mradermacher/Qwen3.5-9B-heretic.Q4_K_M'
    )
    expect(mockAddLocalDownloadingModel).toHaveBeenCalledWith(
      'Qwen3_5-9B-heretic_Q4_K_M'
    )
    expect(mockPullModelWithMetadata).toHaveBeenCalledWith(
      'Qwen3_5-9B-heretic_Q4_K_M',
      ggufVariant.path,
      undefined,
      'hf-test-token'
    )
  })

  it('removes local downloading state and shows an error when the download fails to start', async () => {
    mockPullModelWithMetadata.mockRejectedValueOnce(new Error('IPC unavailable'))

    render(<ModelDownloadAction variant={variant} model={model as never} />)

    fireEvent.click(screen.getByTitle('hub:downloadModel'))

    await vi.waitFor(() => {
      expect(mockRemoveLocalDownloadingModel).toHaveBeenCalledWith('model-q4')
      expect(mockToastError).toHaveBeenCalledWith(
        'Failed to start model download',
        expect.objectContaining({
          description: 'IPC unavailable',
        })
      )
    })
  })
})
