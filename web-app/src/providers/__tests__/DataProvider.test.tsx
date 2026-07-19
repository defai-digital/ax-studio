import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DataProvider } from '../DataProvider'

const {
  mockBootstrapProviders,
  mockBootstrapThreads,
  mockBootstrapUpdater,
  mockBootstrapEvents,
  mockBootstrapLocalApi,
  mockSyncRemoteProviders,
  mockSetApiKey,
  mockSetServerPort,
  mockSetServerStatus,
  mockLocalApiServerState,
} = vi.hoisted(() => ({
  mockBootstrapProviders: vi.fn(),
  mockBootstrapThreads: vi.fn(),
  mockBootstrapUpdater: vi.fn(),
  mockBootstrapEvents: vi.fn(),
  mockBootstrapLocalApi: vi.fn(),
  mockSyncRemoteProviders: vi.fn(),
  mockSetApiKey: vi.fn(),
  mockSetServerPort: vi.fn(),
  mockSetServerStatus: vi.fn(),
  mockLocalApiServerState: {
    enableOnStartup: true,
    serverHost: '127.0.0.1' as const,
    serverPort: 31419,
    apiPrefix: '/v1',
    apiKey: 'ax-test',
    trustedHosts: ['localhost'],
    corsEnabled: true,
    verboseLogs: false,
    proxyTimeout: 600,
    setServerPort: vi.fn(),
    setApiKey: vi.fn(),
  },
}))

// Mock Tauri deep link
vi.mock('@tauri-apps/plugin-deep-link', () => ({
  onOpenUrl: vi.fn(),
  getCurrent: vi.fn().mockResolvedValue([]),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

// The services are handled by the global ServiceHub mock in test setup

// Mock hooks
vi.mock('@/hooks/threads/useThreads', () => ({
  useThreads: vi.fn(() => ({
    setThreads: vi.fn(),
  })),
}))

vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: vi.fn(() => ({
    setProviders: vi.fn(),
  })),
}))

vi.mock('@/hooks/chat/useAssistant', () => ({
  useAssistant: vi.fn(() => ({
    setAssistants: vi.fn(),
  })),
}))

vi.mock('@/hooks/chat/useMessages', () => ({
  useMessages: vi.fn(() => ({
    setMessages: vi.fn(),
  })),
}))

vi.mock('@/hooks/updater/useAppUpdater', () => ({
  useAppUpdater: vi.fn(() => ({
    checkForUpdate: vi.fn(),
  })),
}))

vi.mock('@/hooks/tools/useMCPServers', () => ({
  DEFAULT_MCP_SETTINGS: {},
  useMCPServers: vi.fn(() => ({
    setServers: vi.fn(),
    setSettings: vi.fn(),
  })),
}))

vi.mock('@/hooks/settings/useLocalApiServer', () => ({
  useLocalApiServer: vi.fn(() => mockLocalApiServerState),
}))

vi.mock('@/hooks/settings/useAppState', () => ({
  useAppState: vi.fn((selector) =>
    selector({
      setServerStatus: mockSetServerStatus,
    })
  ),
}))

vi.mock('@/lib/bootstrap/bootstrap-providers', () => ({
  bootstrapProviders: mockBootstrapProviders,
}))

vi.mock('@/lib/bootstrap/bootstrap-threads', () => ({
  bootstrapThreads: mockBootstrapThreads,
}))

vi.mock('@/lib/bootstrap/bootstrap-updater', () => ({
  bootstrapUpdater: mockBootstrapUpdater,
}))

vi.mock('@/lib/bootstrap/bootstrap-events', () => ({
  bootstrapEvents: mockBootstrapEvents,
}))

vi.mock('@/lib/bootstrap/bootstrap-local-api', () => ({
  bootstrapLocalApi: mockBootstrapLocalApi,
}))

vi.mock('@/lib/providers/provider-sync', () => ({
  syncRemoteProviders: mockSyncRemoteProviders,
}))

describe('DataProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(mockLocalApiServerState, {
      enableOnStartup: true,
      serverHost: '127.0.0.1',
      serverPort: 31419,
      apiPrefix: '/v1',
      apiKey: 'ax-test',
      trustedHosts: ['localhost'],
      corsEnabled: true,
      verboseLogs: false,
      proxyTimeout: 600,
      setServerPort: mockSetServerPort,
      setApiKey: mockSetApiKey,
    })
    mockBootstrapProviders.mockResolvedValue({ unsubscribeDeepLink: vi.fn() })
    mockBootstrapThreads.mockResolvedValue(undefined)
    mockBootstrapUpdater.mockReturnValue(vi.fn())
    mockBootstrapEvents.mockReturnValue(vi.fn())
    mockBootstrapLocalApi.mockReturnValue(undefined)
    mockSyncRemoteProviders.mockResolvedValue(undefined)
  })

  it('mounts startup data effects without rendering UI', () => {
    const { container } = render(<DataProvider />)

    expect(container.firstChild).toBeNull()
  })

  it('keeps the document tree unchanged while bootstrapping data', () => {
    const { container } = render(<DataProvider />)

    expect(container.textContent).toBe('')
  })

  it('bootstraps the local API from the initial startup snapshot once', () => {
    const { rerender } = render(<DataProvider />)

    expect(mockBootstrapLocalApi).toHaveBeenCalledTimes(1)
    expect(mockBootstrapLocalApi).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        config: expect.objectContaining({
          host: '127.0.0.1',
          port: 31419,
          prefix: '/v1',
          apiKey: 'ax-test',
          trustedHosts: ['localhost'],
          corsEnabled: true,
          verboseLogs: false,
          proxyTimeout: 600,
        }),
        setServerPort: mockSetServerPort,
        setApiKey: mockSetApiKey,
        setServerStatus: mockSetServerStatus,
      })
    )

    Object.assign(mockLocalApiServerState, {
      enableOnStartup: false,
      serverPort: 1555,
      apiKey: 'ax-updated',
    })

    rerender(<DataProvider />)

    expect(mockBootstrapLocalApi).toHaveBeenCalledTimes(1)
    expect(mockBootstrapLocalApi.mock.calls[0][0].config.port).toBe(31419)
    expect(mockBootstrapLocalApi.mock.calls[0][0].config.apiKey).toBe('ax-test')
  })
})
