import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DataProvider } from '../DataProvider'

// Mock Tauri deep link
vi.mock('@tauri-apps/plugin-deep-link', () => ({
  onOpenUrl: vi.fn(),
  getCurrent: vi.fn().mockResolvedValue([]),
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
  useMCPServers: vi.fn(() => ({
    setServers: vi.fn(),
    setSettings: vi.fn(),
  })),
}))

describe('DataProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders children when all data hooks are available', () => {
    render(
      <DataProvider>
        <div data-testid="child">Test Child</div>
      </DataProvider>
    )

    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('handles multiple children correctly', () => {
    render(
      <DataProvider>
        <div>Test Child 1</div>
        <div>Test Child 2</div>
      </DataProvider>
    )

    expect(screen.getByText('Test Child 1')).toBeInTheDocument()
    expect(screen.getByText('Test Child 2')).toBeInTheDocument()
  })
})
