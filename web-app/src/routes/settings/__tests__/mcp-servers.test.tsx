import type { ComponentType, InputHTMLAttributes, ReactNode } from 'react'
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SystemEvent } from '@/types/events'

const mocks = vi.hoisted(() => {
  const getConnectedServers = vi.fn()

  return {
    addServer: vi.fn(),
    deleteServer: vi.fn(),
    editServer: vi.fn(),
    getConnectedServers,
    getServerConfig: vi.fn(),
    renameServer: vi.fn(),
    serviceHub: {
      mcp: () => ({
        getConnectedServers,
      }),
    },
    setAllowAllMCPPermissions: vi.fn(),
    setErrorMessage: vi.fn(),
    setSettings: vi.fn(),
    syncServers: vi.fn(),
    syncServersAndRestart: vi.fn(),
    updateSettings: vi.fn(),
    listen: vi.fn(),
    unlisten: vi.fn(),
  }
})

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: unknown) => config,
}))

vi.mock('@/constants/routes', () => ({
  route: {
    settings: {
      mcp_servers: '/settings/mcp-servers',
    },
  },
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: mocks.listen,
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('lucide-react', () => ({
  Code: () => <span data-testid="code-icon" />,
  Pencil: () => <span data-testid="pencil-icon" />,
  Plus: () => <span data-testid="plus-icon" />,
  Trash2: () => <span data-testid="trash-icon" />,
  Wrench: () => <span data-testid="wrench-icon" />,
}))

vi.mock('@/containers/HeaderPage', () => ({
  HeaderPage: ({ children }: { children: ReactNode }) => (
    <header data-testid="header-page">{children}</header>
  ),
}))

vi.mock('@/components/common/SettingsMenu', () => ({
  SettingsMenu: () => <nav data-testid="settings-menu" />,
}))

vi.mock('@/components/settings/SettingsPageLayout', () => ({
  SettingsPageLayout: ({ title }: { title: string }) => <h1>{title}</h1>,
}))

vi.mock('@/components/common/Card', () => ({
  Card: ({
    header,
    children,
  }: {
    header?: ReactNode
    children?: ReactNode
  }) => (
    <section data-testid="card">
      {header}
      {children}
    </section>
  ),
  CardItem: ({
    title,
    description,
    descriptionOutside,
    actions,
  }: {
    title?: ReactNode
    description?: ReactNode
    descriptionOutside?: ReactNode
    actions?: ReactNode
  }) => (
    <div data-testid="card-item">
      {title}
      {description}
      {descriptionOutside}
      {actions}
    </div>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    size: _size,
    variant: _variant,
    ...props
  }: {
    children?: ReactNode
    disabled?: boolean
    onClick?: () => void
    size?: string
    variant?: string
  }) => (
    <button disabled={disabled} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    disabled,
    loading: _loading,
    onCheckedChange,
  }: {
    checked: boolean
    disabled?: boolean
    loading?: boolean
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

vi.mock('@/containers/dialogs/mcp/AddEditMCPServer', () => ({
  default: () => null,
}))

vi.mock('@/containers/dialogs/mcp/DeleteMCPServerConfirm', () => ({
  DeleteMCPServerConfirm: () => null,
}))

vi.mock('@/containers/dialogs/mcp/EditJsonMCPserver', () => ({
  default: () => null,
}))

vi.mock('@/hooks/tools/useMCPServers', () => ({
  DEFAULT_MCP_SETTINGS: {
    toolCallTimeoutSeconds: 60,
  },
  useMCPServers: () => ({
    mcpServers: {},
    settings: {
      toolCallTimeoutSeconds: 60,
    },
    addServer: mocks.addServer,
    editServer: mocks.editServer,
    renameServer: mocks.renameServer,
    deleteServer: mocks.deleteServer,
    syncServers: mocks.syncServers,
    syncServersAndRestart: mocks.syncServersAndRestart,
    getServerConfig: mocks.getServerConfig,
    setSettings: mocks.setSettings,
    updateSettings: mocks.updateSettings,
  }),
}))

vi.mock('@/hooks/tools/useToolApproval', () => ({
  useToolApproval: () => ({
    allowAllMCPPermissions: false,
    setAllowAllMCPPermissions: mocks.setAllowAllMCPPermissions,
  }),
}))

vi.mock('@/hooks/settings/useAppState', () => ({
  useAppState: (
    selector: (state: {
      setErrorMessage: typeof mocks.setErrorMessage
    }) => unknown
  ) =>
    selector({
      setErrorMessage: mocks.setErrorMessage,
    }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => mocks.serviceHub,
}))

vi.mock('@/lib/utils', () => ({
  cn: (...classes: Array<string | false | undefined>) =>
    classes.filter(Boolean).join(' '),
}))

import { Route } from '../mcp-servers'

function renderMCPServersRoute() {
  const Component = Route.component as ComponentType
  return render(<Component />)
}

describe('MCP servers settings route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as typeof globalThis & { IS_MACOS: boolean }).IS_MACOS = false
    mocks.getConnectedServers.mockResolvedValue([])
    mocks.listen.mockResolvedValue(mocks.unlisten)
  })

  it('unsubscribes when the MCP update listener resolves after unmount', async () => {
    let resolveListen: ((unlisten: () => void) => void) | undefined
    mocks.listen.mockReturnValue(
      new Promise<() => void>((resolve) => {
        resolveListen = resolve
      })
    )

    const { unmount } = renderMCPServersRoute()

    await waitFor(() => {
      expect(mocks.listen).toHaveBeenCalledWith(
        SystemEvent.MCP_UPDATE,
        expect.any(Function)
      )
    })

    unmount()

    await act(async () => {
      resolveListen?.(mocks.unlisten)
      await Promise.resolve()
    })

    expect(mocks.unlisten).toHaveBeenCalledTimes(1)
  })

  it('ignores MCP update events after unmount', async () => {
    let updateHandler: (() => void) | undefined
    mocks.listen.mockImplementation((_event: string, callback: () => void) => {
      updateHandler = callback
      return Promise.resolve(mocks.unlisten)
    })

    const { unmount } = renderMCPServersRoute()

    await waitFor(() => {
      expect(mocks.getConnectedServers).toHaveBeenCalledTimes(1)
      expect(updateHandler).toBeDefined()
    })

    unmount()
    vi.clearAllMocks()

    act(() => {
      updateHandler?.()
    })

    expect(mocks.getConnectedServers).not.toHaveBeenCalled()
  })
})
