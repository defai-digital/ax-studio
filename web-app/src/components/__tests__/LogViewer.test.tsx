import { act, render, screen, waitFor } from '@testing-library/react'
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

  it('shows empty state message when no logs', async () => {
    render(<LogViewer />)
    await waitFor(() => {
      expect(screen.getByText('No logs to display')).toBeInTheDocument()
    })
  })

  it('calls readLogs on mount', async () => {
    render(<LogViewer />)
    await waitFor(() => {
      expect(mockReadLogs).toHaveBeenCalledTimes(1)
    })
  })

  it('subscribes to log events on mount', async () => {
    render(<LogViewer />)
    await waitFor(() => {
      expect(mockListen).toHaveBeenCalledWith('log://log', expect.any(Function))
    })
  })

  it('ignores live log events after unmount', async () => {
    let listener:
      | ((event: { payload: { message: string } }) => void)
      | undefined
    const unsubscribe = vi.fn()
    mockListen.mockImplementationOnce(async (_event, callback) => {
      listener = callback
      return unsubscribe
    })

    const { unmount } = render(<LogViewer />)

    await waitFor(() => {
      expect(listener).toBeDefined()
    })

    unmount()

    act(() => {
      listener?.({ payload: { message: 'late log line' } })
    })

    expect(unsubscribe).toHaveBeenCalled()
    expect(mockParseLogLine).not.toHaveBeenCalled()
  })

  it('unsubscribes when live log subscription resolves after unmount', async () => {
    let resolveListen!: (unsubscribe: () => void) => void
    const unsubscribe = vi.fn()
    mockListen.mockImplementationOnce(
      () =>
        new Promise<() => void>((resolve) => {
          resolveListen = resolve
        })
    )

    const { unmount } = render(<LogViewer />)

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalled()
    })

    unmount()

    await act(async () => {
      resolveListen(unsubscribe)
      await Promise.resolve()
    })

    expect(unsubscribe).toHaveBeenCalled()
  })
})
