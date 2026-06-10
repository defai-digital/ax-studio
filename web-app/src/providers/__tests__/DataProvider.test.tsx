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
} = vi.hoisted(() => ({
  mockBootstrapProviders: vi.fn(),
  mockBootstrapThreads: vi.fn(),
  mockBootstrapUpdater: vi.fn(),
  mockBootstrapEvents: vi.fn(),
  mockBootstrapLocalApi: vi.fn(),
  mockSyncRemoteProviders: vi.fn(),
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
})
