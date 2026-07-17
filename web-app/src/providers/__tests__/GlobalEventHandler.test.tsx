import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GlobalEventHandler } from '../GlobalEventHandler'

const {
  eventHandlers,
  mockEvents,
  mockSetProviders,
  mockSetActiveModels,
  mockToastError,
  mockToastInfo,
  mockToastSuccess,
  mockGetProviders,
  mockGetActiveModels,
  mockCoreInvoke,
  mockUpdateProgress,
  mockRemoveDownload,
  mockRemoveLocalDownloadingModel,
} = vi.hoisted(() => {
  const eventHandlers = new Map<string, Set<(payload?: any) => void>>()

  return {
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
    mockSetProviders: vi.fn(),
    mockSetActiveModels: vi.fn(),
    mockToastError: vi.fn(),
    mockToastInfo: vi.fn(),
    mockToastSuccess: vi.fn(),
    mockGetProviders: vi.fn(),
    mockGetActiveModels: vi.fn(),
    mockCoreInvoke: vi.fn(),
    mockUpdateProgress: vi.fn(),
    mockRemoveDownload: vi.fn(),
    mockRemoveLocalDownloadingModel: vi.fn(),
  }
})

vi.mock('@ax-studio/core', () => ({
  events: mockEvents,
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
  useNavigate: () => vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: () => ({
    setProviders: mockSetProviders,
  }),
}))

vi.mock('@/hooks/settings/useAppState', () => ({
  useAppState: (selector: (state: { setActiveModels: typeof mockSetActiveModels }) => unknown) =>
    selector({ setActiveModels: mockSetActiveModels }),
}))

vi.mock('@/hooks/models/useDownloadStore', () => ({
  useDownloadStore: () => ({
    updateProgress: mockUpdateProgress,
    removeDownload: mockRemoveDownload,
    removeLocalDownloadingModel: mockRemoveLocalDownloadingModel,
  }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    providers: () => ({
      getProviders: mockGetProviders,
    }),
    models: () => ({
      getActiveModels: mockGetActiveModels,
    }),
    core: () => ({
      invoke: mockCoreInvoke,
    }),
    path: () => ({
      sep: () => '/',
    }),
  }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    error: mockToastError,
    info: mockToastInfo,
    success: mockToastSuccess,
  },
}))

function emit(event: string, payload?: any) {
  for (const handler of eventHandlers.get(event) ?? []) {
    handler(payload)
  }
}

describe('GlobalEventHandler', () => {
  beforeEach(() => {
    eventHandlers.clear()
    vi.clearAllMocks()
    mockGetProviders.mockResolvedValue([{ provider: 'llamacpp', models: [] }])
    mockGetActiveModels.mockResolvedValue(['model-a'])
    mockCoreInvoke.mockResolvedValue(undefined)
  })

  it('refreshes providers on version_backend settings change', async () => {
    render(<GlobalEventHandler />)

    emit('settingsChanged', { key: 'version_backend', value: 'new/backend' })

    await waitFor(() => {
      expect(mockGetProviders).toHaveBeenCalled()
      expect(mockSetProviders).toHaveBeenCalledWith(
        [{ provider: 'llamacpp', models: [] }],
        '/'
      )
    })
  })

  it('shows bridge toast events from extensions', () => {
    render(<GlobalEventHandler />)

    emit('onShowToast', {
      title: 'llama.cpp backend setup failed',
      message: 'Backend configuration failed: network down',
    })

    expect(mockToastInfo).toHaveBeenCalledWith(
      'llama.cpp backend setup failed',
      { description: 'Backend configuration failed: network down' }
    )
  })

  it('refreshes active models on model ready and model stopped events', async () => {
    render(<GlobalEventHandler />)

    emit('OnModelReady', {
      modelId: 'model-a',
      port: 11434,
      api_key: 'local-key',
      provider: 'llamacpp',
    })

    await waitFor(() => {
      expect(mockCoreInvoke).toHaveBeenCalledWith('register_provider_config', {
        request: {
          provider: 'llamacpp',
          api_key: 'local-key',
          base_url: 'http://127.0.0.1:11434/v1',
          custom_headers: [],
          models: ['model-a'],
        },
      })
    })

    emit('OnModelStopped', { provider: 'llamacpp' })

    await waitFor(() => {
      expect(mockGetActiveModels).toHaveBeenCalledTimes(2)
      expect(mockSetActiveModels).toHaveBeenCalledWith(['model-a'])
      expect(mockCoreInvoke).toHaveBeenCalledWith('unregister_provider_config', {
        provider: 'llamacpp',
      })
    })
  })

  it('refreshes active models when model ready payload is missing modelId', async () => {
    render(<GlobalEventHandler />)

    emit('OnModelReady')

    await waitFor(() => {
      expect(mockGetActiveModels).toHaveBeenCalledTimes(1)
      expect(mockSetActiveModels).toHaveBeenCalledWith(['model-a'])
    })
  })

  it('shows translated error toast on model failure', async () => {
    render(<GlobalEventHandler />)

    emit('OnModelFail', { modelId: 'model-a', error: 'OUT_OF_MEMORY occurred' })

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        'settings:llamacpp.errors.outOfMemory'
      )
    })
  })

  it('shows crash recovery guidance for Windows llama.dll failures', async () => {
    render(<GlobalEventHandler />)

    emit('OnModelFail', {
      modelId: 'model-a',
      error: 'llama.dll exited after Vulkan GPU offload process crashed',
    })

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        'settings:llamacpp.errors.processCrashed'
      )
    })
  })

  it('shows success toast after model import without duplicating provider refresh', async () => {
    render(<GlobalEventHandler />)

    emit('onModelImported', { modelId: 'model-a' })

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith(
        'settings:llamacpp.errors.modelImported'
      )
    })
    expect(mockGetProviders).not.toHaveBeenCalled()
    expect(mockSetProviders).not.toHaveBeenCalled()
  })

  it('normalizes fractional and whole-number download progress updates', async () => {
    render(<GlobalEventHandler />)

    emit('onFileDownloadUpdate', {
      downloadId: 'mlx-community/gemma-4-12B-it-4bit',
      modelId: 'mlx-community/gemma-4-12B-it-4bit',
      percent: 1,
      size: { transferred: 1, total: 1 },
    })
    emit('onFileDownloadUpdate', {
      downloadId: 'legacy-percent',
      modelId: 'legacy-percent',
      percent: 75,
      size: { transferred: 75, total: 100 },
    })

    expect(mockUpdateProgress).toHaveBeenNthCalledWith(
      1,
      'mlx-community/gemma-4-12B-it-4bit',
      1,
      'mlx-community/gemma-4-12B-it-4bit',
      1,
      1
    )
    expect(mockUpdateProgress).toHaveBeenNthCalledWith(
      2,
      'legacy-percent',
      0.75,
      'legacy-percent',
      75,
      100
    )
  })
})
