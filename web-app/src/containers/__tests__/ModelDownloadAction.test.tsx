import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAddLocalDownloadingModel,
  mockRemoveLocalDownloadingModel,
  mockPullModelWithMetadata,
  mockNavigate,
  mockToastError,
} = vi.hoisted(() => ({
  mockAddLocalDownloadingModel: vi.fn(),
  mockRemoveLocalDownloadingModel: vi.fn(),
  mockPullModelWithMetadata: vi.fn(),
  mockNavigate: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('@/hooks/models/useDownloadStore', () => ({
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
    selector({ getProviderByName: () => ({ models: [] }) })
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

vi.mock('@tabler/icons-react', () => ({
  IconDownload: () => <span data-testid="download-icon" />,
}))

import { ModelDownloadAction } from '../ModelDownloadAction'

describe('ModelDownloadAction', () => {
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
    mockPullModelWithMetadata.mockResolvedValue(undefined)
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
