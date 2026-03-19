import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LogViewer } from '../LogViewer'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'logs:noLogs': 'No logs to display',
      }
      return map[key] ?? key
    },
  }),
}))

const mockReadLogs = vi.fn().mockResolvedValue([])
const mockListen = vi.fn().mockResolvedValue(() => {})
const mockParseLogLine = vi.fn()

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    app: () => ({
      readLogs: mockReadLogs,
      parseLogLine: mockParseLogLine,
    }),
    events: () => ({
      listen: mockListen,
    }),
  }),
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    scrollToIndex: vi.fn(),
    measureElement: vi.fn(),
  }),
}))

describe('LogViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows empty state message when no logs', () => {
    render(<LogViewer />)
    expect(screen.getByText('No logs to display')).toBeInTheDocument()
  })

  it('calls readLogs on mount', () => {
    render(<LogViewer />)
    expect(mockReadLogs).toHaveBeenCalledTimes(1)
  })

  it('subscribes to log events on mount', () => {
    render(<LogViewer />)
    expect(mockListen).toHaveBeenCalledWith(
      'log://log',
      expect.any(Function)
    )
  })
})
