import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SettingsMenu } from '../SettingsMenu'
import { useMatches } from '@tanstack/react-router'

// Mock dependencies
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className }: any) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useMatches: vi.fn(),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
  }),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}))

describe('SettingsMenu', () => {
  const mockMatches = [
    {
      routeId: '/settings/general',
      pathname: '/settings/general',
      params: {},
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useMatches).mockReturnValue(mockMatches)
  })

  it('renders the three focused settings destinations', () => {
    render(<SettingsMenu />)

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(3)
  })

  it('separates local products from cloud providers', () => {
    render(<SettingsMenu />)

    expect(screen.getByText('common:general')).toBeInTheDocument()
    expect(screen.getByText('common:axEngine')).toBeInTheDocument()
    expect(screen.getByText('common:modelProviders')).toBeInTheDocument()

    // Legacy standalone preference pages remain removed or merged.
    expect(screen.queryByText('common:interface')).not.toBeInTheDocument()
    expect(screen.queryByText('common:privacy')).not.toBeInTheDocument()
    expect(screen.queryByText('common:hardware')).not.toBeInTheDocument()
    expect(screen.queryByText('common:extensions')).not.toBeInTheDocument()
    expect(screen.queryByText('common:mcp-servers')).not.toBeInTheDocument()
  })

  it('links only the kept routes', () => {
    render(<SettingsMenu />)

    const hrefs = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))

    expect(hrefs).toEqual([
      '/settings/general',
      '/settings/ax-engine',
      '/settings/providers/',
    ])
  })

  it('uses a flat list without group headers', () => {
    render(<SettingsMenu />)

    expect(screen.queryByText('App')).not.toBeInTheDocument()
    expect(screen.queryByText('AI')).not.toBeInTheDocument()
    expect(
      screen.queryByText('common:settingsGroupApp')
    ).not.toBeInTheDocument()
    expect(screen.queryByText('common:settingsGroupAi')).not.toBeInTheDocument()
  })

  it('highlights the active menu item', () => {
    render(<SettingsMenu />)

    const generalLink = screen.getByText('common:general').closest('a')
    expect(generalLink?.className).toContain('bg-primary/10')
    expect(generalLink?.className).toContain('text-primary')
  })

  it('does not highlight inactive menu items', () => {
    render(<SettingsMenu />)

    const providersLink = screen.getByText('common:modelProviders').closest('a')
    expect(providersLink?.className).toContain('text-muted-foreground')
    expect(providersLink?.className).not.toContain('bg-primary/10')
  })

  it('highlights model providers when on a provider sub-route', () => {
    vi.mocked(useMatches).mockReturnValue([
      {
        routeId: '/settings/providers/$providerName',
        pathname: '/settings/providers/openai',
        params: { providerName: 'openai' },
      },
    ])

    render(<SettingsMenu />)

    const providersLink = screen.getByText('common:modelProviders').closest('a')
    expect(providersLink?.className).toContain('bg-primary/10')
    expect(providersLink?.className).toContain('text-primary')

    const generalLink = screen.getByText('common:general').closest('a')
    expect(generalLink?.className).not.toContain('bg-primary/10')
  })

  it('highlights AX Engine instead of cloud providers for legacy detail URLs', () => {
    vi.mocked(useMatches).mockReturnValue([
      {
        routeId: '/settings/providers/$providerName',
        pathname: '/settings/providers/ax-engine',
        params: { providerName: 'ax-engine' },
      },
    ])

    render(<SettingsMenu />)

    expect(
      screen.getByText('common:axEngine').closest('a')?.className
    ).toContain('bg-primary/10')
    expect(
      screen.getByText('common:modelProviders').closest('a')?.className
    ).not.toContain('bg-primary/10')
  })

  it('has no workspace-mode or advanced-toggle logic', () => {
    localStorage.setItem('workspace-mode', 'simple-chat')
    localStorage.setItem('settings-show-advanced', 'false')

    render(<SettingsMenu />)

    // The focused list is stable regardless of legacy localStorage flags.
    expect(screen.getAllByRole('link')).toHaveLength(3)
    expect(
      screen.queryByText('common:showAdvancedSettings')
    ).not.toBeInTheDocument()

    localStorage.clear()
  })
})
