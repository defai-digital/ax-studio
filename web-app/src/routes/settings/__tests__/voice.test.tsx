import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Route as VoiceRoute } from '../voice'

const mocks = vi.hoisted(() => ({
  voice: {
    isAvailable: vi.fn().mockReturnValue(true),
    startRecording: vi.fn().mockResolvedValue(undefined),
    stopRecording: vi.fn().mockResolvedValue(''),
    cancelRecording: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockResolvedValue({
      state: 'idle',
      modelDownloaded: false,
      audioLevel: 0,
    }),
    downloadModel: vi.fn().mockResolvedValue(undefined),
    cancelModelDownload: vi.fn().mockResolvedValue(undefined),
    deleteModel: vi.fn().mockResolvedValue(undefined),
  },
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
}))

// Mock dependencies
vi.mock('@/components/common/SettingsMenu', () => ({
  SettingsMenu: () => <div data-testid="settings-menu">Settings Menu</div>,
}))

vi.mock('@/containers/HeaderPage', () => ({
  HeaderPage: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="header-page">{children}</div>
  ),
}))

vi.mock('@/components/settings/SettingsPageLayout', () => ({
  SettingsPageLayout: ({ title }: { title: string }) => (
    <div data-testid="settings-page-layout">{title}</div>
  ),
}))

vi.mock('@/components/common/Card', () => ({
  Card: ({
    title,
    children,
  }: {
    title?: React.ReactNode
    children: React.ReactNode
  }) => (
    <div data-testid="card">
      {title && <div data-testid="card-title">{title}</div>}
      {children}
    </div>
  ),
  CardItem: ({
    title,
    description,
    descriptionOutside,
    actions,
  }: {
    title?: string
    description?: string
    descriptionOutside?: string
    actions?: React.ReactNode
  }) => (
    <div data-testid="card-item" data-title={title}>
      {title && <div data-testid="card-item-title">{title}</div>}
      {description && (
        <div data-testid="card-item-description">{description}</div>
      )}
      {descriptionOutside && (
        <div data-testid="card-item-description-outside">
          {descriptionOutside}
        </div>
      )}
      {actions && <div data-testid="card-item-actions">{actions}</div>}
    </div>
  ),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    voice: () => mocks.voice,
    events: () => ({
      listen: vi.fn().mockResolvedValue(() => {}),
      emit: vi.fn().mockResolvedValue(undefined),
    }),
  }),
}))

vi.mock('@/constants/routes', () => ({
  route: {
    settings: {
      voice: '/settings/voice',
    },
  },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: (path: string) => (config: any) => ({
    ...config,
    component: config.component,
  }),
}))

vi.mock('sonner', () => ({ toast: mocks.toast }))

import { useVoiceSettings } from '@/hooks/settings/useVoiceSettings'

describe('Voice Settings Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useVoiceSettings.setState({
      voiceInputEnabled: false,
      voiceModel: 'base.en',
    })
    mocks.voice.getStatus.mockResolvedValue({
      state: 'idle',
      modelDownloaded: false,
      audioLevel: 0,
    })
  })

  const renderPage = () => {
    const Component = VoiceRoute.component as React.ComponentType
    return render(<Component />)
  }

  it('renders the voice settings page with the on-device note', async () => {
    renderPage()

    await waitFor(() => {
      expect(mocks.voice.getStatus).toHaveBeenCalledWith('base.en')
      expect(mocks.voice.getStatus).toHaveBeenCalledWith('small.en')
    })

    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
    expect(screen.getByTestId('settings-page-layout')).toHaveTextContent(
      'common:voice'
    )
    // The local-first trust signal is always visible.
    expect(
      screen.getByTestId('card-item-description-outside')
    ).toHaveTextContent('settings:voice.onDeviceNote')
  })

  it('toggles the voice input setting', async () => {
    renderPage()

    await waitFor(() => {
      expect(mocks.voice.getStatus).toHaveBeenCalledTimes(2)
    })

    const toggle = screen.getByTestId('voice-enable-switch')
    fireEvent.click(toggle)

    expect(useVoiceSettings.getState().voiceInputEnabled).toBe(true)
  })

  it('changes the selected speech model', async () => {
    renderPage()

    await waitFor(() => {
      expect(mocks.voice.getStatus).toHaveBeenCalledTimes(2)
    })

    const select = screen.getByTestId('voice-model-select')
    fireEvent.change(select, { target: { value: 'small.en' } })

    expect(useVoiceSettings.getState().voiceModel).toBe('small.en')
  })

  it('queries model download status on mount and offers downloads', async () => {
    renderPage()

    await waitFor(() => {
      expect(mocks.voice.getStatus).toHaveBeenCalledWith('base.en')
      expect(mocks.voice.getStatus).toHaveBeenCalledWith('small.en')
    })

    expect(screen.getByTestId('voice-model-download-base.en')).toBeInTheDocument()
    expect(screen.getByTestId('voice-model-download-small.en')).toBeInTheDocument()
  })

  it('downloads a model and marks it downloaded', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('voice-model-download-base.en')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('voice-model-download-base.en'))

    expect(mocks.voice.downloadModel).toHaveBeenCalledWith('base.en')
    await waitFor(() => {
      expect(screen.getByTestId('voice-model-delete-base.en')).toBeInTheDocument()
    })
  })

  it('shows an error toast when the download fails', async () => {
    mocks.voice.downloadModel.mockRejectedValueOnce(new Error('network down'))
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('voice-model-download-base.en')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('voice-model-download-base.en'))

    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalledWith(
        'settings:voice.downloadFailed'
      )
    })
  })

  it('deletes a downloaded model', async () => {
    mocks.voice.getStatus.mockImplementation(async (model: string) => ({
      state: 'idle',
      modelDownloaded: model === 'small.en',
      audioLevel: 0,
    }))
    renderPage()

    await waitFor(() => {
      expect(screen.getByTestId('voice-model-delete-small.en')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('voice-model-delete-small.en'))

    expect(mocks.voice.deleteModel).toHaveBeenCalledWith('small.en')
    await waitFor(() => {
      expect(
        screen.getByTestId('voice-model-download-small.en')
      ).toBeInTheDocument()
    })
  })
})
