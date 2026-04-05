import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GlobalEventHandler } from '../GlobalEventHandler'

const {
  eventHandlers,
  mockEvents,
  mockSetProviders,
  mockSetActiveModels,
  mockToastError,
  mockToastSuccess,
  mockGetProviders,
  mockGetActiveModels,
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
    mockToastSuccess: vi.fn(),
    mockGetProviders: vi.fn(),
    mockGetActiveModels: vi.fn(),
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
  },
  DownloadEvent: {
    onModelValidationFailed: 'onModelValidationFailed',
    onFileDownloadUpdate: 'onFileDownloadUpdate',
    onFileDownloadSuccess: 'onFileDownloadSuccess',
    onFileDownloadError: 'onFileDownloadError',
    onFileDownloadStopped: 'onFileDownloadStopped',
    onFileDownloadAndVerificationSuccess: 'onFileDownloadAndVerificationSuccess',
  },
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
    updateProgress: vi.fn(),
    removeDownload: vi.fn(),
    removeLocalDownloadingModel: vi.fn(),
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

  it('refreshes active models on model ready and model stopped events', async () => {
    render(<GlobalEventHandler />)

    emit('OnModelReady', { modelId: 'model-a' })
    emit('OnModelStopped', { modelId: 'model-a' })

    await waitFor(() => {
      expect(mockGetActiveModels).toHaveBeenCalledTimes(2)
      expect(mockSetActiveModels).toHaveBeenCalledWith(['model-a'])
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

  it('refreshes providers and shows success toast after model import', async () => {
    render(<GlobalEventHandler />)

    emit('onModelImported', { modelId: 'model-a' })

    await waitFor(() => {
      expect(mockGetProviders).toHaveBeenCalled()
      expect(mockSetProviders).toHaveBeenCalledWith(
        [{ provider: 'llamacpp', models: [] }],
        '/'
      )
      expect(mockToastSuccess).toHaveBeenCalledWith(
        'settings:llamacpp.errors.modelImported'
      )
    })
  })
})
