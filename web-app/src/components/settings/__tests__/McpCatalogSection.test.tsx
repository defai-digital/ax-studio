import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { McpCatalogSection } from '../McpCatalogSection'
import { useMCPServers } from '@/hooks/tools/useMCPServers'
import bundledCatalog from '@/constants/mcp-catalog.json'

const dialogProps = vi.hoisted(() => ({
  current: undefined as
    | { open: boolean; entry: { name: string } | null }
    | undefined,
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    mcp: () => ({
      updateMCPConfig: vi.fn(),
      restartMCPServers: vi.fn(),
    }),
  }),
}))

vi.mock('@/containers/dialogs/mcp/McpCatalogInstallDialog', () => ({
  McpCatalogInstallDialog: (props: {
    open: boolean
    entry: { name: string } | null
  }) => {
    dialogProps.current = props
    return null
  },
}))

describe('McpCatalogSection', () => {
  beforeEach(() => {
    dialogProps.current = undefined
    useMCPServers.setState({ mcpServers: {} })
  })

  it('renders every bundled catalog entry with trust signals', () => {
    render(<McpCatalogSection />)

    for (const entry of bundledCatalog) {
      expect(screen.getByText(entry.title)).toBeInTheDocument()
      expect(screen.getByText(entry.capabilitiesNote)).toBeInTheDocument()
    }
    expect(
      screen.getAllByText('mcp-servers:catalog.reviewedBadge')
    ).toHaveLength(bundledCatalog.length)
    expect(screen.getByText('v2026.7.10')).toBeInTheDocument()
    expect(screen.getAllByText('stdio').length).toBeGreaterThan(0)
    expect(screen.getAllByText('http').length).toBeGreaterThan(0)
  })

  it('shows a disabled Installed state for servers already configured', () => {
    useMCPServers.setState({
      mcpServers: {
        github: { command: 'npx', args: [], env: {}, active: false },
      },
    })
    render(<McpCatalogSection />)

    const installed = screen.getByText('mcp-servers:catalog.installed')
    expect(installed).toBeDisabled()

    const installButtons = screen.getAllByText('mcp-servers:catalog.install')
    expect(installButtons.length).toBe(bundledCatalog.length - 1)
    for (const button of installButtons) {
      expect(button).toBeEnabled()
    }
  })

  it('opens the install dialog for the clicked entry', () => {
    render(<McpCatalogSection />)
    expect(dialogProps.current?.open).toBe(false)

    fireEvent.click(screen.getAllByText('mcp-servers:catalog.install')[0])

    expect(dialogProps.current?.open).toBe(true)
    expect(dialogProps.current?.entry?.name).toBe(bundledCatalog[0].name)
  })
})
