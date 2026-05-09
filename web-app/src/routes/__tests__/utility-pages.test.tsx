import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  readLogs: vi.fn(),
  listen: vi.fn(),
  parseLogLine: vi.fn(),
  getSystemUsage: vi.fn(),
  updateSystemUsage: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: { component: React.ComponentType }) => config,
}))

vi.mock('@/constants/routes', () => ({
  route: {
    appLogs: '/logs',
    localApiServerlogs: '/local-api-server/logs',
    systemMonitor: '/system-monitor',
  },
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    app: () => ({
      parseLogLine: mocks.parseLogLine,
      readLogs: mocks.readLogs,
    }),
    events: () => ({
      listen: mocks.listen,
    }),
    hardware: () => ({
      getSystemUsage: mocks.getSystemUsage,
    }),
  }),
}))

vi.mock('@/hooks/settings/useHardware', () => ({
  useHardware: () => ({
    hardwareData: {
      cpu: {
        arch: 'arm64',
        core_count: 12,
        name: 'Apple M4 Pro',
      },
      total_memory: 32768,
    },
    systemUsage: {
      cpu: 25,
      used_memory: 8192,
      total_memory: 32768,
    },
    updateSystemUsage: mocks.updateSystemUsage,
  }),
}))

vi.mock('@/components/ui/progress', () => ({
  Progress: ({ value }: { value: number }) => (
    <div data-testid="progress">{value}</div>
  ),
}))

vi.mock('@/lib/utils', () => ({
  formatMegaBytes: (mb: number) => `${mb} MB`,
}))

vi.mock('@/lib/utils/number', () => ({
  toNumber: (value: number) => value,
}))

vi.mock('lucide-react', () => ({
  Monitor: () => <span data-testid="monitor-icon" />,
}))

import { Route as AppLogsRoute } from '../logs'
import { Route as LocalApiLogsRoute } from '../local-api-server/logs'
import { Route as SystemMonitorRoute } from '../system-monitor'

describe('utility routes', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.listen.mockResolvedValue(vi.fn())
    mocks.parseLogLine.mockReturnValue({
      level: 'info',
      message: 'server ready',
      target: 'app_lib::core::server::proxy',
      timestamp: '2026-05-09T00:00:00.000Z',
    })
    mocks.getSystemUsage.mockResolvedValue({
      cpu: 33,
      used_memory: 12288,
      total_memory: 32768,
    })
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('renders app logs and keeps polling cleanup safe', async () => {
    mocks.readLogs.mockResolvedValue([
      {
        level: 'warn',
        message: 'careful now',
        timestamp: '2026-05-09T00:00:00.000Z',
      },
    ])
    const Component = AppLogsRoute.component as React.ComponentType
    const { unmount } = render(<Component />)

    await waitFor(() => {
      expect(screen.getByText('WARN')).toBeInTheDocument()
      expect(screen.getByText('careful now')).toBeInTheDocument()
    })

    unmount()
  })

  it('filters local API server logs and appends matching live events', async () => {
    let listener: ((event: { payload: { message: string } }) => void) | undefined
    mocks.readLogs.mockResolvedValue([
      {
        level: 'info',
        message: 'server booted',
        target: 'app_lib::core::server::proxy',
        timestamp: '2026-05-09T00:00:00.000Z',
      },
      {
        level: 'debug',
        message: 'ignored',
        target: 'other',
        timestamp: '2026-05-09T00:00:00.000Z',
      },
    ])
    mocks.listen.mockImplementation(async (_event, callback) => {
      listener = callback
      return vi.fn()
    })

    const Component = LocalApiLogsRoute.component as React.ComponentType
    render(<Component />)

    await waitFor(() => {
      expect(screen.getByText('server booted')).toBeInTheDocument()
      expect(screen.queryByText('ignored')).not.toBeInTheDocument()
    })

    act(() => {
      listener?.({ payload: { message: 'live log line' } })
    })

    await waitFor(() => {
      expect(screen.getByText('server ready')).toBeInTheDocument()
    })
  })

  it('renders system monitor usage and updates usage from service hub', async () => {
    const Component = SystemMonitorRoute.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('system-monitor:title')).toBeInTheDocument()
    expect(screen.getByText('Apple M4 Pro')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('8192 MB')).toBeInTheDocument()

    await waitFor(() => {
      expect(mocks.updateSystemUsage).toHaveBeenCalledWith({
        cpu: 33,
        used_memory: 12288,
        total_memory: 32768,
      })
    })
  })
})
