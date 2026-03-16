import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SettingsMenu from '../SettingsMenu'
import { useMatches } from '@tanstack/react-router'

// Mock global platform constants - simulate desktop (Tauri) environment
Object.defineProperty(global, 'IS_IOS', { value: false, writable: true })
Object.defineProperty(global, 'IS_ANDROID', { value: false, writable: true })
Object.defineProperty(global, 'IS_WEB_APP', { value: false, writable: true })

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
    t: (key: string) => key,
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

  it('renders all settings page links', () => {
    render(<SettingsMenu />)

    const links = screen.getAllByRole('link')
    // Should have at least the main settings pages
    expect(links.length).toBeGreaterThanOrEqual(10)
  })

  it('renders text labels for menu items', () => {
    render(<SettingsMenu />)

    expect(screen.getByText('common:general')).toBeInTheDocument()
    expect(screen.getByText('common:interface')).toBeInTheDocument()
    expect(screen.getByText('common:privacy')).toBeInTheDocument()
    expect(screen.getByText('common:modelProviders')).toBeInTheDocument()
  })

  it('renders all settings labels', () => {
    render(<SettingsMenu />)
    expect(screen.getByText('common:keyboardShortcuts')).toBeInTheDocument()
    expect(screen.getByText('common:hardware')).toBeInTheDocument()
    expect(screen.getByText('common:local_api_server')).toBeInTheDocument()
    expect(screen.getByText('common:https_proxy')).toBeInTheDocument()
    expect(screen.getByText('common:mcp-servers')).toBeInTheDocument()
  })

  it('renders correct link hrefs for each settings page', () => {
    render(<SettingsMenu />)

    const links = screen.getAllByRole('link')
    const hrefs = links.map((link) => link.getAttribute('href'))

    expect(hrefs).toContain('/settings/general')
    expect(hrefs).toContain('/settings/interface')
    expect(hrefs).toContain('/settings/privacy')
    expect(hrefs).toContain('/settings/providers')
  })

  it('renders group headers', () => {
    render(<SettingsMenu />)

    expect(screen.getByText('App')).toBeInTheDocument()
    expect(screen.getByText('AI')).toBeInTheDocument()
    expect(screen.getByText('Advanced')).toBeInTheDocument()
    expect(screen.getByText('Other')).toBeInTheDocument()
  })

  it('highlights active menu item', () => {
    render(<SettingsMenu />)

    const generalLink = screen
      .getByText('common:general')
      .closest('a')
    expect(generalLink?.className).toContain('bg-primary/10')
    expect(generalLink?.className).toContain('text-primary')
  })

  it('does not highlight inactive menu items', () => {
    render(<SettingsMenu />)

    const interfaceLink = screen
      .getByText('common:interface')
      .closest('a')
    expect(interfaceLink?.className).toContain('text-muted-foreground')
    expect(interfaceLink?.className).not.toContain('bg-primary/10')
  })

  it('highlights model providers when on provider sub-route', () => {
    vi.mocked(useMatches).mockReturnValue([
      {
        routeId: '/settings/providers/$providerName',
        pathname: '/settings/providers/openai',
        params: { providerName: 'openai' },
      },
    ])

    render(<SettingsMenu />)

    const providersLink = screen
      .getByText('common:modelProviders')
      .closest('a')
    expect(providersLink?.className).toContain('bg-primary/10')
    expect(providersLink?.className).toContain('text-primary')
  })
})
