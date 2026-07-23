import type { ComponentType, InputHTMLAttributes, ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SystemEvent } from '@/types/events'

const mocks = vi.hoisted(() => {
  const getConnectedServers = vi.fn()
  const activateMCPServer = vi.fn()
  const deactivateMCPServer = vi.fn()
  const mcpServers: Record<string, Record<string, unknown>> = {}
  const addServer = vi.fn((key: string, config: Record<string, unknown>) => {
    mcpServers[key] = config
  })
  const deleteServer = vi.fn((key: string) => {
    delete mcpServers[key]
  })
  const editServer = vi.fn((key: string, config: Record<string, unknown>) => {
    mcpServers[key] = config
  })
  const getServerConfig = vi.fn((key: string) => mcpServers[key])
  const renameServer = vi.fn(
    (oldKey: string, newKey: string, config: Record<string, unknown>) => {
      delete mcpServers[oldKey]
      mcpServers[newKey] = config
    }
  )

  return {
    addServer,
    activateMCPServer,
    deactivateMCPServer,
    deleteServer,
    editServer,
    getConnectedServers,
    getServerConfig,
    mcpServers,
    renameServer,
    serviceHub: {
      mcp: () => ({
        activateMCPServer,
        deactivateMCPServer,
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
    addEditDialog: {
      onSave: undefined as
        | ((name: string, config: Record<string, unknown>) => Promise<boolean>)
        | undefined,
    },
    jsonDialog: {
      onSave: undefined as
        | ((data: Record<string, unknown>) => Promise<boolean>)
        | undefined,
    },
    deleteDialog: {
      onConfirm: undefined as (() => Promise<boolean>) | undefined,
    },
    toastError: vi.fn(),
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
    error: mocks.toastError,
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
  AddEditMCPServer: ({
    onSave,
  }: {
    onSave: (name: string, config: Record<string, unknown>) => Promise<boolean>
  }) => {
    mocks.addEditDialog.onSave = onSave
    return null
  },
}))

vi.mock('@/containers/dialogs/mcp/DeleteMCPServerConfirm', () => ({
  DeleteMCPServerConfirm: ({
    onConfirm,
  }: {
    onConfirm: () => Promise<boolean>
  }) => {
    mocks.deleteDialog.onConfirm = onConfirm
    return null
  },
}))

vi.mock('@/containers/dialogs/mcp/EditJsonMCPserver', () => ({
  EditJsonMCPserver: ({
    onSave,
  }: {
    onSave: (data: Record<string, unknown>) => Promise<boolean>
  }) => {
    mocks.jsonDialog.onSave = onSave
    return null
  },
}))

vi.mock('@/components/settings/McpCatalogSection', () => ({
  McpCatalogSection: () => null,
}))

vi.mock('@/hooks/tools/useMCPServers', () => ({
  DEFAULT_MCP_SETTINGS: {
    toolCallTimeoutSeconds: 60,
  },
  useMCPServers: () => ({
    mcpServers: mocks.mcpServers,
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
    for (const key of Object.keys(mocks.mcpServers)) {
      delete mocks.mcpServers[key]
    }
    mocks.addEditDialog.onSave = undefined
    mocks.jsonDialog.onSave = undefined
    mocks.deleteDialog.onConfirm = undefined
    ;(globalThis as typeof globalThis & { IS_MACOS: boolean }).IS_MACOS = false
    mocks.getConnectedServers.mockResolvedValue([])
    mocks.activateMCPServer.mockResolvedValue(undefined)
    mocks.deactivateMCPServer.mockResolvedValue(undefined)
    mocks.syncServers.mockResolvedValue(undefined)
    mocks.syncServersAndRestart.mockResolvedValue(undefined)
    mocks.listen.mockResolvedValue(mocks.unlisten)
  })

  afterEach(() => {
    vi.restoreAllMocks()
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

  it('updates tool call timeout only for decimal integer seconds in range', async () => {
    renderMCPServersRoute()
    await waitFor(() => {
      expect(mocks.getConnectedServers).toHaveBeenCalled()
    })

    const input = screen.getByDisplayValue('60')

    fireEvent.change(input, { target: { value: '120' } })
    expect(mocks.updateSettings).toHaveBeenLastCalledWith({
      toolCallTimeoutSeconds: 120,
    })

    mocks.updateSettings.mockClear()

    for (const value of ['0', '-1', '1.5', '1e3', '3601']) {
      fireEvent.change(input, { target: { value } })
    }

    expect(mocks.updateSettings).not.toHaveBeenCalled()
  })

  it('resets empty tool call timeout input to the default', async () => {
    renderMCPServersRoute()
    await waitFor(() => {
      expect(mocks.getConnectedServers).toHaveBeenCalled()
    })

    fireEvent.change(screen.getByDisplayValue('60'), {
      target: { value: '' },
    })

    expect(mocks.updateSettings).toHaveBeenCalledWith({
      toolCallTimeoutSeconds: 60,
    })
  })

  it('waits for an edited server to stop before starting its replacement', async () => {
    mocks.mcpServers.alpha = { command: 'old-command', active: true }
    let resolveStop!: () => void
    mocks.deactivateMCPServer.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveStop = resolve
        })
    )
    renderMCPServersRoute()

    fireEvent.click(screen.getByLabelText('mcp-servers:editServer'))
    await waitFor(() => {
      expect(mocks.addEditDialog.onSave).toBeDefined()
    })

    let saveWork!: Promise<boolean>
    act(() => {
      saveWork = mocks.addEditDialog.onSave?.('alpha', {
        command: 'new-command',
        active: true,
    }) as Promise<boolean>
    })
    await waitFor(() => {
      expect(mocks.deactivateMCPServer).toHaveBeenCalledWith('alpha')
    })
    expect(mocks.activateMCPServer).not.toHaveBeenCalled()

    await act(async () => {
      resolveStop()
      await saveWork
    })

    expect(mocks.activateMCPServer).toHaveBeenCalledWith(
      'alpha',
      expect.objectContaining({ command: 'new-command', active: true })
    )
  })

  it('adds a server before starting it and waits for persistence', async () => {
    renderMCPServersRoute()

    await act(async () => {
      await expect(
        mocks.addEditDialog.onSave?.('new-server', {
          command: 'new-command',
          active: true,
        })
      ).resolves.toBe(true)
    })

    expect(mocks.addServer).toHaveBeenCalledWith(
      'new-server',
      expect.objectContaining({ command: 'new-command' })
    )
    expect(mocks.activateMCPServer).toHaveBeenCalledWith(
      'new-server',
      expect.objectContaining({ command: 'new-command', active: true })
    )
    expect(mocks.syncServers).toHaveBeenCalled()
  })

  it('keeps an explicitly inactive new server stopped', async () => {
    renderMCPServersRoute()

    await act(async () => {
      await expect(
        mocks.addEditDialog.onSave?.('new-server', {
          command: 'new-command',
          active: false,
        })
      ).resolves.toBe(true)
    })

    expect(mocks.addServer).toHaveBeenCalledWith(
      'new-server',
      expect.objectContaining({ active: false })
    )
    expect(mocks.activateMCPServer).not.toHaveBeenCalled()
    expect(mocks.deactivateMCPServer).not.toHaveBeenCalled()
    expect(mocks.syncServers).toHaveBeenCalledOnce()
  })

  it('does not activate an inactive server after editing it', async () => {
    mocks.mcpServers.alpha = { command: 'old-command', active: false }
    renderMCPServersRoute()

    fireEvent.click(screen.getByLabelText('mcp-servers:editServer'))
    await act(async () => {
      await expect(
        mocks.addEditDialog.onSave?.('alpha', {
          command: 'new-command',
          active: false,
        })
      ).resolves.toBe(true)
    })

    expect(mocks.activateMCPServer).not.toHaveBeenCalled()
    expect(mocks.deactivateMCPServer).not.toHaveBeenCalled()
    expect(mocks.mcpServers.alpha).toEqual({
      command: 'new-command',
      active: false,
    })
  })

  it('does not overwrite an existing server during rename', async () => {
    mocks.mcpServers.alpha = { command: 'alpha-command', active: true }
    mocks.mcpServers.beta = { command: 'beta-command', active: false }
    renderMCPServersRoute()

    fireEvent.click(
      screen.getAllByLabelText('mcp-servers:editServer')[0]
    )
    await act(async () => {
      await expect(
        mocks.addEditDialog.onSave?.('beta', {
          command: 'replacement-command',
          active: true,
        })
      ).resolves.toBe(false)
    })

    expect(mocks.deactivateMCPServer).not.toHaveBeenCalled()
    expect(mocks.renameServer).not.toHaveBeenCalled()
    expect(mocks.mcpServers.beta).toEqual({
      command: 'beta-command',
      active: false,
    })
  })

  it('rolls back the switch when stopping a server fails', async () => {
    mocks.mcpServers.alpha = { command: 'server-command', active: true }
    mocks.deactivateMCPServer.mockRejectedValueOnce(new Error('stop failed'))
    renderMCPServersRoute()

    fireEvent.click(screen.getByRole('checkbox', { checked: true }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        'Failed to stop MCP server "alpha"',
        expect.objectContaining({ description: 'stop failed' })
      )
    })
    expect(mocks.editServer).toHaveBeenLastCalledWith(
      'alpha',
      expect.objectContaining({ active: true })
    )
    expect(mocks.setErrorMessage).toHaveBeenCalled()
  })

  it('keeps the switch off when the backend server is already stopped', async () => {
    mocks.mcpServers.alpha = { command: 'server-command', active: true }
    mocks.deactivateMCPServer.mockRejectedValueOnce(
      new Error('Server alpha not found')
    )
    renderMCPServersRoute()

    fireEvent.click(screen.getByRole('checkbox', { checked: true }))

    await waitFor(() => {
      expect(mocks.editServer).toHaveBeenLastCalledWith(
        'alpha',
        expect.objectContaining({ active: false })
      )
    })
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(mocks.setErrorMessage).not.toHaveBeenCalled()
  })

  it('aborts a bulk JSON replacement when an existing server cannot stop', async () => {
    mocks.mcpServers.alpha = { command: 'old-command', active: true }
    mocks.deactivateMCPServer.mockRejectedValueOnce(new Error('stop failed'))
    renderMCPServersRoute()

    await act(async () => {
      await mocks.jsonDialog.onSave?.({
        mcpServers: {
          replacement: { command: 'new-command', active: true },
        },
        mcpSettings: { toolCallTimeoutSeconds: 120 },
      })
    })

    expect(mocks.deleteServer).not.toHaveBeenCalled()
    expect(mocks.addServer).not.toHaveBeenCalled()
    expect(mocks.activateMCPServer).not.toHaveBeenCalled()
    expect(mocks.setSettings).not.toHaveBeenCalled()
  })

  it('deletes an inactive server without asking the backend to stop it', async () => {
    mocks.mcpServers.alpha = { command: 'server-command', active: false }
    renderMCPServersRoute()

    fireEvent.click(
      screen.getByRole('button', { name: 'mcp-servers:deleteServer.title' })
    )
    await act(async () => {
      await mocks.deleteDialog.onConfirm?.()
    })

    expect(mocks.deactivateMCPServer).not.toHaveBeenCalled()
    expect(mocks.deleteServer).toHaveBeenCalledWith('alpha')
    expect(mocks.syncServersAndRestart).toHaveBeenCalledOnce()
  })

  it('reports a delete persistence failure instead of closing successfully', async () => {
    mocks.mcpServers.alpha = { command: 'server-command', active: false }
    mocks.syncServersAndRestart.mockRejectedValueOnce(new Error('disk full'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderMCPServersRoute()

    fireEvent.click(
      screen.getByRole('button', { name: 'mcp-servers:deleteServer.title' })
    )
    await act(async () => {
      await expect(mocks.deleteDialog.onConfirm?.()).resolves.toBe(false)
    })

    expect(mocks.toastError).toHaveBeenCalledWith(
      'Failed to restart MCP servers',
      { description: 'disk full' }
    )
  })

  it('handles a JSON configuration sync failure without rejecting', async () => {
    mocks.syncServers.mockRejectedValueOnce(new Error('disk full'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderMCPServersRoute()
    const saveJson = mocks.jsonDialog.onSave
    expect(saveJson).toBeDefined()

    await act(async () => {
      await expect(
        saveJson!({
          mcpServers: {
            replacement: { command: 'new-command', active: false },
          },
        })
      ).resolves.toBe(false)
    })

    expect(mocks.toastError).toHaveBeenCalledWith(
      'Failed to save MCP server configuration',
      { description: 'disk full' }
    )
  })
})
