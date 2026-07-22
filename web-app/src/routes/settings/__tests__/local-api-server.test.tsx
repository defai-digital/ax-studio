import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

const mocks = vi.hoisted(() => {
  const localApiState = {} as {
    corsEnabled: boolean
    setCorsEnabled: ReturnType<typeof vi.fn>
    verboseLogs: boolean
    setVerboseLogs: ReturnType<typeof vi.fn>
    enableOnStartup: boolean
    setEnableOnStartup: ReturnType<typeof vi.fn>
    serverHost: '127.0.0.1' | '0.0.0.0'
    setServerHost: ReturnType<typeof vi.fn>
    serverPort: number
    setServerPort: ReturnType<typeof vi.fn>
    apiPrefix: string
    setApiPrefix: ReturnType<typeof vi.fn>
    apiKey: string
    setApiKey: ReturnType<typeof vi.fn>
    trustedHosts: string[]
    setTrustedHosts: ReturnType<typeof vi.fn>
    addTrustedHost: ReturnType<typeof vi.fn>
    removeTrustedHost: ReturnType<typeof vi.fn>
    proxyTimeout: number
    setProxyTimeout: ReturnType<typeof vi.fn>
  }
  const appState = {} as {
    serverStatus: 'running' | 'stopped' | 'pending'
    setServerStatus: ReturnType<typeof vi.fn>
    activeModels: string[]
    setActiveModels: ReturnType<typeof vi.fn>
  }

  const setServerStatus = vi.fn((value: 'running' | 'stopped' | 'pending') => {
    appState.serverStatus = value
  })
  const setActiveModels = vi.fn((models: string[]) => {
    appState.activeModels = models
  })
  const setServerPort = vi.fn((value: number) => {
    localApiState.serverPort = value
  })
  const setProxyTimeout = vi.fn((value: number) => {
    localApiState.proxyTimeout = value
  })

  Object.assign(localApiState, {
    corsEnabled: true,
    setCorsEnabled: vi.fn((value: boolean) => {
      localApiState.corsEnabled = value
    }),
    verboseLogs: true,
    setVerboseLogs: vi.fn((value: boolean) => {
      localApiState.verboseLogs = value
    }),
    enableOnStartup: true,
    setEnableOnStartup: vi.fn((value: boolean) => {
      localApiState.enableOnStartup = value
    }),
    serverHost: '127.0.0.1',
    setServerHost: vi.fn(),
    serverPort: 31419,
    setServerPort,
    apiPrefix: '/v1',
    setApiPrefix: vi.fn(),
    apiKey: 'ax-test-key',
    setApiKey: vi.fn(),
    trustedHosts: ['localhost'],
    setTrustedHosts: vi.fn(),
    addTrustedHost: vi.fn(),
    removeTrustedHost: vi.fn(),
    proxyTimeout: 600,
    setProxyTimeout,
  })

  Object.assign(appState, {
    serverStatus: 'stopped',
    setServerStatus,
    activeModels: [],
    setActiveModels,
  })

  return {
    appState,
    getActiveModels: vi.fn(),
    getServerStatus: vi.fn(),
    localApiState,
    openLocalApiServerLogsWindow: vi.fn(),
    setProxyTimeout,
    setActiveModels,
    setServerPort,
    setServerStatus,
    startModel: vi.fn(),
    startServer: vi.fn(),
    stopServer: vi.fn(),
    toast: {
      dismiss: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      success: vi.fn(),
    },
  }
})

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: unknown) => config,
}))

vi.mock('@/constants/routes', () => ({
  route: {
    settings: {
      local_api_server: '/settings/local-api-server',
    },
  },
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('sonner', () => ({
  toast: mocks.toast,
}))

vi.mock('lucide-react', () => ({
  ChevronDown: () => <span data-testid="chevron-down" />,
  ChevronUp: () => <span data-testid="chevron-up" />,
  ChevronsUpDown: () => <span data-testid="chevrons-up-down" />,
  ExternalLink: () => <span data-testid="external-link" />,
  Server: () => <span data-testid="server-icon" />,
  Wrench: () => <span data-testid="wrench-icon" />,
}))

vi.mock('@/components/common/SettingsMenu', () => ({
  SettingsMenu: () => <nav data-testid="settings-menu" />,
}))

vi.mock('@/containers/HeaderPage', () => ({
  HeaderPage: ({ children }: { children: React.ReactNode }) => (
    <header data-testid="header-page">{children}</header>
  ),
}))

vi.mock('@/components/settings/SettingsPageLayout', () => ({
  SettingsPageLayout: ({ title }: { title: string }) => <h1>{title}</h1>,
}))

vi.mock('@/components/common/Card', () => ({
  Card: ({
    header,
    children,
  }: {
    header?: React.ReactNode
    children?: React.ReactNode
  }) => (
    <section data-testid="card">
      {header}
      {children}
    </section>
  ),
  CardItem: ({
    title,
    description,
    actions,
  }: {
    title?: React.ReactNode
    description?: React.ReactNode
    actions?: React.ReactNode
  }) => (
    <div data-testid="card-item">
      {title && <div>{title}</div>}
      {description && <div>{description}</div>}
      {actions}
    </div>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    ...props
  }: {
    children: React.ReactNode
    disabled?: boolean
    onClick?: () => void
  }) => (
    <button disabled={disabled} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    disabled,
    onCheckedChange,
  }: {
    checked: boolean
    disabled?: boolean
    onCheckedChange: (checked: boolean) => void
  }) => (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange(event.currentTarget.checked)}
    />
  ),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode
    onClick?: () => void
  }) => <button onClick={onClick}>{children}</button>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover-content">{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

vi.mock('@/components/ui/collapsible', () => ({
  Collapsible: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  CollapsibleContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CollapsibleTrigger: ({ children }: { children: React.ReactNode }) => (
    <button>{children}</button>
  ),
}))

vi.mock('@/containers/TrustedHostsInput', () => ({
  TrustedHostsInput: () => <div data-testid="trusted-hosts-input" />,
}))

vi.mock('@/containers/ApiKeyInput', () => ({
  ApiKeyInput: ({ showError }: { showError?: boolean }) => (
    <div data-testid="api-key-input" data-show-error={String(!!showError)} />
  ),
}))

vi.mock('@/components/LogViewer', () => ({
  LogViewer: () => <div data-testid="log-viewer" />,
}))

vi.mock('@/containers/AkidbConfigPanel', () => ({
  AkidbConfigPanel: () => <div data-testid="akidb-config-panel" />,
}))

vi.mock('@/hooks/settings/useLocalApiServer', () => ({
  useLocalApiServer: () => mocks.localApiState,
}))

vi.mock('@/hooks/settings/useAppState', () => ({
  useAppState: (selector?: (state: typeof mocks.appState) => unknown) =>
    selector ? selector(mocks.appState) : mocks.appState,
}))

vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: () => ({
    selectedModel: 'model-1',
    selectedProvider: 'provider-1',
    getProviderByName: vi.fn(() => ({
      provider: 'provider-1',
      models: [{ id: 'model-1' }],
    })),
  }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    app: () => ({
      getServerStatus: mocks.getServerStatus,
    }),
    models: () => ({
      getActiveModels: mocks.getActiveModels,
      startModel: mocks.startModel,
    }),
    window: () => ({
      openLocalApiServerLogsWindow: mocks.openLocalApiServerLogsWindow,
    }),
  }),
}))

vi.mock('@/lib/utils/getModelToStart', () => ({
  getModelToStart: () => ({
    provider: 'provider-1',
    model: 'model-1',
  }),
}))

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>()
  return {
    ...actual,
    cn: (...classes: Array<string | false | undefined>) =>
      classes.filter(Boolean).join(' '),
  }
})

import { Route } from '../local-api-server'

function renderLocalApiServerRoute() {
  const Component = Route.component as React.ComponentType
  return render(<Component />)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

describe('Local API Server settings route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    Object.assign(mocks.localApiState, {
      corsEnabled: true,
      verboseLogs: true,
      enableOnStartup: true,
      serverHost: '127.0.0.1',
      serverPort: 31419,
      apiPrefix: '/v1',
      apiKey: 'ax-test-key',
      trustedHosts: ['localhost'],
      proxyTimeout: 600,
    })
    Object.assign(mocks.appState, {
      serverStatus: 'stopped',
      setServerStatus: mocks.setServerStatus,
      activeModels: [],
      setActiveModels: mocks.setActiveModels,
    })

    mocks.getServerStatus.mockResolvedValue(false)
    mocks.getActiveModels.mockResolvedValue(['provider-1:model-1'])
    mocks.startModel.mockResolvedValue(undefined)
    mocks.startServer.mockResolvedValue(1444)
    mocks.stopServer.mockResolvedValue(undefined)
    mocks.openLocalApiServerLogsWindow.mockResolvedValue(undefined)

    window.core = {
      api: {
        startServer: mocks.startServer,
        stopServer: mocks.stopServer,
      },
    } as unknown as Window['core']
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the stopped server state and checks current status on mount', async () => {
    renderLocalApiServerRoute()

    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
    expect(screen.getByText('common:local_api_server')).toBeInTheDocument()
    expect(screen.getByText('The server is stopped.')).toBeInTheDocument()

    await waitFor(() => {
      expect(mocks.getServerStatus).toHaveBeenCalledTimes(1)
    })
  })

  it('ignores delayed status checks after the route unmounts', async () => {
    const statusCheck = deferred<boolean>()
    mocks.getServerStatus.mockReturnValue(statusCheck.promise)

    const { unmount } = renderLocalApiServerRoute()

    expect(mocks.getServerStatus).toHaveBeenCalledTimes(1)
    unmount()

    await act(async () => {
      statusCheck.resolve(true)
      await statusCheck.promise
    })

    expect(mocks.setServerStatus).not.toHaveBeenCalled()
  })

  it('blocks server start when CORS requires an API key but no key is set', async () => {
    mocks.localApiState.apiKey = ''

    renderLocalApiServerRoute()
    fireEvent.click(screen.getByText('settings:localApiServer.startServer'))

    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalledWith('API key required', {
        description:
          'Set an API key before enabling CORS or binding the local API server to a non-loopback host.',
      })
    })

    expect(mocks.startServer).not.toHaveBeenCalled()
    expect(mocks.setServerStatus).toHaveBeenCalledWith('stopped')
  })

  it('starts the local API server with configured host, port, prefix, and auth', async () => {
    renderLocalApiServerRoute()
    fireEvent.click(screen.getByText('settings:localApiServer.startServer'))

    await waitFor(() => {
      expect(mocks.startServer).toHaveBeenCalledWith({
        host: '127.0.0.1',
        port: 31419,
        prefix: '/v1',
        apiKey: 'ax-test-key',
        trustedHosts: ['localhost'],
        isCorsEnabled: true,
        isVerboseEnabled: true,
        proxyTimeout: 600,
      })
    })

    expect(mocks.startModel).not.toHaveBeenCalled()
    expect(mocks.setServerPort).toHaveBeenCalledWith(1444)
    expect(mocks.setServerStatus).toHaveBeenCalledWith('running')
    expect(mocks.toast.success).toHaveBeenCalledWith('Server started', {
      description: 'Local API server running on port 1444',
    })
  })

  it('normalizes string port results from the local API bridge', async () => {
    mocks.startServer.mockResolvedValueOnce('1555')
    renderLocalApiServerRoute()
    fireEvent.click(screen.getByText('settings:localApiServer.startServer'))

    await waitFor(() => {
      expect(mocks.setServerPort).toHaveBeenCalledWith(1555)
    })
    expect(mocks.toast.success).toHaveBeenCalledWith('Server started', {
      description: 'Local API server running on port 1555',
    })
  })

  it('ignores malformed port results from the local API bridge', async () => {
    mocks.startServer.mockResolvedValueOnce('0x539')
    renderLocalApiServerRoute()
    fireEvent.click(screen.getByText('settings:localApiServer.startServer'))

    await waitFor(() => {
      expect(mocks.setServerStatus).toHaveBeenCalledWith('running')
    })
    expect(mocks.setServerPort).not.toHaveBeenCalled()
    expect(mocks.toast.success).toHaveBeenCalledWith('Server started', {
      description: 'Local API server running on port 31419',
    })
  })

  it('rejects fractional server port input instead of truncating it', () => {
    renderLocalApiServerRoute()

    const portInput = screen.getByDisplayValue('31419')

    fireEvent.change(portInput, { target: { value: '31419.5' } })
    fireEvent.blur(portInput)

    expect(mocks.setServerPort).not.toHaveBeenCalled()
    expect(portInput).toHaveValue(31419)
  })

  it('rejects non-decimal server port input instead of coercing it', () => {
    renderLocalApiServerRoute()

    const portInput = screen.getByDisplayValue('31419')

    fireEvent.change(portInput, { target: { value: '1e3' } })
    fireEvent.blur(portInput)

    expect(mocks.setServerPort).not.toHaveBeenCalled()
    expect(portInput).toHaveValue(31419)

    fireEvent.change(portInput, { target: { value: '0x539' } })
    fireEvent.blur(portInput)

    expect(mocks.setServerPort).not.toHaveBeenCalled()
    expect(portInput).toHaveValue(31419)
  })

  it('rejects fractional proxy timeout input instead of truncating it', () => {
    renderLocalApiServerRoute()

    const timeoutInput = screen.getByDisplayValue('600')

    fireEvent.change(timeoutInput, { target: { value: '600.5' } })
    fireEvent.blur(timeoutInput)

    expect(mocks.setProxyTimeout).not.toHaveBeenCalled()
    expect(timeoutInput).toHaveValue(600)
  })

  it('rejects non-decimal proxy timeout input instead of coercing it', () => {
    renderLocalApiServerRoute()

    const timeoutInput = screen.getByDisplayValue('600')

    fireEvent.change(timeoutInput, { target: { value: '1e3' } })
    fireEvent.blur(timeoutInput)

    expect(mocks.setProxyTimeout).not.toHaveBeenCalled()
    expect(timeoutInput).toHaveValue(600)
  })

  it('stops the local API server when it is already running', async () => {
    mocks.appState.serverStatus = 'running'
    mocks.getServerStatus.mockResolvedValue(true)

    renderLocalApiServerRoute()
    fireEvent.click(screen.getByText('settings:localApiServer.stopServer'))

    await waitFor(() => {
      expect(mocks.stopServer).toHaveBeenCalledTimes(1)
    })

    expect(mocks.setServerStatus).toHaveBeenCalledWith('pending')
    expect(mocks.setServerStatus).toHaveBeenCalledWith('stopped')
  })

  it('restores running status when stopping the server fails', async () => {
    mocks.appState.serverStatus = 'running'
    mocks.getServerStatus.mockResolvedValue(true)
    mocks.stopServer.mockRejectedValueOnce(new Error('backend refused'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    renderLocalApiServerRoute()
    fireEvent.click(screen.getByText('settings:localApiServer.stopServer'))

    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalledWith('Failed to stop server', {
        description: 'backend refused',
      })
    })
    expect(mocks.setServerStatus).toHaveBeenLastCalledWith('running')
  })

  it('keeps running status when the bridge is unavailable during stop', async () => {
    mocks.appState.serverStatus = 'running'
    mocks.getServerStatus.mockResolvedValue(true)
    window.core = undefined

    renderLocalApiServerRoute()
    fireEvent.click(screen.getByText('settings:localApiServer.stopServer'))

    await waitFor(() => {
      expect(mocks.toast.error).toHaveBeenCalledWith('Failed to stop server', {
        description: 'Core API not available',
      })
    })
    expect(mocks.setServerStatus).toHaveBeenLastCalledWith('running')
    expect(mocks.stopServer).not.toHaveBeenCalled()
  })

  it('updates a stale running status after the server stops externally', async () => {
    mocks.appState.serverStatus = 'running'
    mocks.getServerStatus
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
    renderLocalApiServerRoute()
    await waitFor(() => {
      expect(mocks.getServerStatus).toHaveBeenCalledOnce()
    })
    mocks.setServerStatus.mockClear()

    window.dispatchEvent(new Event('focus'))

    await waitFor(() => {
      expect(mocks.setServerStatus).toHaveBeenCalledWith('stopped')
    })
  })

  it('does not let a delayed status check overwrite a completed start', async () => {
    const statusCheck = deferred<boolean>()
    mocks.getServerStatus.mockReturnValueOnce(statusCheck.promise)
    renderLocalApiServerRoute()

    fireEvent.click(screen.getByText('settings:localApiServer.startServer'))
    await waitFor(() => {
      expect(mocks.setServerStatus).toHaveBeenCalledWith('running')
    })

    await act(async () => {
      statusCheck.resolve(false)
      await statusCheck.promise
    })

    expect(mocks.setServerStatus).toHaveBeenLastCalledWith('running')
  })

  it('ignores a focus status check started while the server is starting', async () => {
    const start = deferred<number>()
    const statusCheck = deferred<boolean>()
    mocks.startServer.mockReturnValueOnce(start.promise)
    renderLocalApiServerRoute()
    await waitFor(() => {
      expect(mocks.getServerStatus).toHaveBeenCalledOnce()
    })

    fireEvent.click(screen.getByText('settings:localApiServer.startServer'))
    await waitFor(() => {
      expect(mocks.startServer).toHaveBeenCalledOnce()
    })

    mocks.getServerStatus.mockReturnValueOnce(statusCheck.promise)
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => {
      expect(mocks.getServerStatus).toHaveBeenCalledTimes(2)
    })

    await act(async () => {
      start.resolve(31419)
      await start.promise
    })
    await waitFor(() => {
      expect(mocks.setServerStatus).toHaveBeenLastCalledWith('running')
    })

    await act(async () => {
      statusCheck.resolve(false)
      await statusCheck.promise
    })
    expect(mocks.setServerStatus).toHaveBeenLastCalledWith('running')
  })
})
