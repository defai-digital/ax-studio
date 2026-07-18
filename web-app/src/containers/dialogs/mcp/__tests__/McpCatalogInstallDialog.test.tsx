import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import { McpCatalogInstallDialog } from '../McpCatalogInstallDialog'
import { useMCPServers } from '@/hooks/tools/useMCPServers'
import type { McpCatalogEntry } from '@/schemas/mcp-catalog.schema'

const mocks = vi.hoisted(() => ({
  addServer: vi.fn(),
  syncServers: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: vi.fn(),
  },
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    children,
    open,
  }: {
    children: ReactNode
    open: boolean
  }) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children?: ReactNode
    onClick?: () => void
    disabled?: boolean
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

const stdioEntry: McpCatalogEntry = {
  name: 'github',
  title: 'GitHub',
  description: 'GitHub API tools',
  publisher: 'Model Context Protocol',
  repoUrl: 'https://github.com/modelcontextprotocol/servers',
  version: '2025.4.8',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github@2025.4.8'],
  env: [
    {
      key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
      description: 'A GitHub PAT',
      required: true,
      secret: true,
    },
    {
      key: 'GITHUB_TOOLSETS',
      description: 'Optional toolsets',
      required: false,
      secret: false,
      defaultValue: 'all',
    },
  ],
  capabilitiesNote: 'Can modify repos with your token',
}

const httpEntry: McpCatalogEntry = {
  name: 'remote-search',
  title: 'Remote Search',
  description: 'Hosted search',
  publisher: 'Example Co',
  repoUrl: 'https://github.com/example/remote-search',
  version: '1.0.0',
  transport: 'http',
  url: 'https://mcp.example.com/mcp',
  headers: [
    {
      key: 'Authorization',
      description: 'Bearer token',
      required: true,
      secret: true,
    },
  ],
  capabilitiesNote: 'Sends queries to the hosted service',
}

function renderDialog(entry: McpCatalogEntry | null, open = true) {
  const onOpenChange = vi.fn()
  render(
    <McpCatalogInstallDialog
      open={open}
      onOpenChange={onOpenChange}
      entry={entry}
    />
  )
  return { onOpenChange }
}

describe('McpCatalogInstallDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useMCPServers.setState({
      addServer: mocks.addServer,
      syncServers: mocks.syncServers,
    })
  })

  it('shows the full untruncated command and args for stdio entries', () => {
    renderDialog(stdioEntry)
    expect(
      screen.getByText(
        'npx -y @modelcontextprotocol/server-github@2025.4.8'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('mcp-servers:catalog.warning')).toBeInTheDocument()
    expect(
      screen.getByText('https://github.com/modelcontextprotocol/servers')
    ).toBeInTheDocument()
  })

  it('blocks Confirm until required env vars are filled', () => {
    renderDialog(stdioEntry)
    const confirm = screen.getByText('mcp-servers:catalog.confirmInstall')
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByLabelText('GITHUB_PERSONAL_ACCESS_TOKEN'), {
      target: { value: 'ghp_secret' },
    })
    expect(confirm).toBeEnabled()
  })

  it('masks secret env values with a password input', () => {
    renderDialog(stdioEntry)
    expect(screen.getByLabelText('GITHUB_PERSONAL_ACCESS_TOKEN')).toHaveAttribute(
      'type',
      'password'
    )
    expect(screen.getByLabelText('GITHUB_TOOLSETS')).toHaveAttribute(
      'type',
      'text'
    )
  })

  it('prefills default env values', () => {
    renderDialog(stdioEntry)
    expect(screen.getByLabelText('GITHUB_TOOLSETS')).toHaveValue('all')
  })

  it('produces the correct stdio config on Confirm, kept inactive', () => {
    const { onOpenChange } = renderDialog(stdioEntry)
    fireEvent.change(screen.getByLabelText('GITHUB_PERSONAL_ACCESS_TOKEN'), {
      target: { value: '  ghp_secret  ' },
    })
    fireEvent.click(screen.getByText('mcp-servers:catalog.confirmInstall'))

    expect(mocks.addServer).toHaveBeenCalledWith('github', {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github@2025.4.8'],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_secret',
        GITHUB_TOOLSETS: 'all',
      },
      type: 'stdio',
      active: false,
    })
    expect(mocks.syncServers).toHaveBeenCalledOnce()
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      'mcp-servers:catalog.installSuccess'
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('produces the correct http config with headers on Confirm', () => {
    renderDialog(httpEntry)
    expect(screen.getByText('https://mcp.example.com/mcp')).toBeInTheDocument()

    const confirm = screen.getByText('mcp-servers:catalog.confirmInstall')
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Authorization'), {
      target: { value: 'Bearer abc' },
    })
    fireEvent.click(confirm)

    expect(mocks.addServer).toHaveBeenCalledWith('remote-search', {
      command: '',
      args: [],
      env: {},
      type: 'http',
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: 'Bearer abc' },
      active: false,
    })
    expect(mocks.syncServers).toHaveBeenCalledOnce()
  })

  it('renders nothing without an entry', () => {
    const { container } = render(
      <McpCatalogInstallDialog
        open
        onOpenChange={vi.fn()}
        entry={null}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
