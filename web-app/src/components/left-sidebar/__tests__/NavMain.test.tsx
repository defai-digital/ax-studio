import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NavMain } from '../NavMain'

const mockSetSearchOpen = vi.fn()

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'common:newChat': 'New Chat',
        'common:search': 'Search',
        'common:hub': 'AI Model Hub',
      }
      return map[key] ?? key
    },
  }),
}))

vi.mock('@/hooks/ui/useSearchDialog', () => ({
  useSearchDialog: () => ({
    open: false,
    setOpen: mockSetSearchOpen,
  }),
}))

vi.mock('@/constants/routes', () => ({
  route: {
    home: '/',
    hub: { index: '/hub' },
    settings: {
      assistant: '/settings/assistant',
      mcp_servers: '/settings/mcp-servers',
    },
  },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: Record<string, unknown>) => (
    <a href={to as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}))

vi.mock('@/containers/dialogs/SearchDialog', () => ({
  SearchDialog: () => null,
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenuButton: ({
    children,
    asChild: _asChild,
    tooltip: _tooltip,
    ...props
  }: {
    children: React.ReactNode
    asChild?: boolean
    tooltip?: string
    onMouseEnter?: () => void
    onMouseLeave?: () => void
  }) => <div {...props}>{children}</div>,
  SidebarMenuItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock('../animated-icon/blocks', () => ({
  BlocksIcon: vi.fn(() => <span data-testid="blocks-icon" />),
}))

describe('NavMain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders New Chat link', () => {
    render(<NavMain />)
    const links = screen.getAllByText('New Chat')
    expect(links.length).toBeGreaterThanOrEqual(1)
  })

  it('renders Search button', () => {
    render(<NavMain />)
    expect(screen.getByText('Search...')).toBeInTheDocument()
  })

  it('renders the descriptive AI Model Hub link', () => {
    render(<NavMain />)
    expect(screen.getByText('AI Model Hub')).toBeInTheDocument()
  })

  it('opens search dialog when search button is clicked', async () => {
    const user = userEvent.setup()
    render(<NavMain />)

    // Click the visible search button (not the collapsed icon-only one)
    const buttons = screen.getAllByText('Search...')
    await user.click(buttons[0])
    expect(mockSetSearchOpen).toHaveBeenCalledWith(true)
  })

  it('shows keyboard shortcut hints', () => {
    render(<NavMain />)

    const modifier = navigator.userAgent.toUpperCase().includes('MAC')
      ? '⌘'
      : 'Ctrl'
    expect(
      screen.getByText((_, element) => element?.textContent === `${modifier}N`)
    ).toBeInTheDocument()
    expect(
      screen.getByText((_, element) => element?.textContent === `${modifier}K`)
    ).toBeInTheDocument()
  })

  it('hides assistants and tools entries under Electron', () => {
    ;(window as unknown as Record<string, unknown>).axElectron = {}
    try {
      render(<NavMain />)

      expect(screen.queryByText('common:assistants')).not.toBeInTheDocument()
      expect(screen.queryByText('common:tools')).not.toBeInTheDocument()
      expect(screen.getByText('AI Model Hub')).toBeInTheDocument()
      expect(screen.queryByText('AX BI')).not.toBeInTheDocument()
    } finally {
      delete (window as unknown as Record<string, unknown>).axElectron
    }
  })
})
