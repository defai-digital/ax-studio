import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Mocks ---

const mockTools = [
  { name: 'tool-a', server: 'server-1', description: 'Description A' },
  { name: 'tool-b', server: 'server-1', description: 'Description B' },
  { name: 'tool-c', server: 'server-2', description: '' },
]

let currentTools = mockTools

vi.mock('@/hooks/useAppState', () => ({
  useAppState: vi.fn((selector) =>
    selector({ tools: currentTools })
  ),
}))

vi.mock('@/hooks/useThreads', () => ({
  useThreads: vi.fn((selector) =>
    selector({ getCurrentThread: () => ({ id: 'thread-1' }) })
  ),
}))

const mockIsToolDisabled = vi.fn().mockReturnValue(false)
const mockSetToolDisabledForThread = vi.fn()
const mockSetDefaultDisabledTools = vi.fn()
const mockInitializeThreadTools = vi.fn()
const mockGetDisabledToolsForThread = vi.fn().mockReturnValue([])
const mockGetDefaultDisabledTools = vi.fn().mockReturnValue([])

vi.mock('@/hooks/useToolAvailable', () => ({
  useToolAvailable: () => ({
    isToolDisabled: mockIsToolDisabled,
    setToolDisabledForThread: mockSetToolDisabledForThread,
    setDefaultDisabledTools: mockSetDefaultDisabledTools,
    initializeThreadTools: mockInitializeThreadTools,
    getDisabledToolsForThread: mockGetDisabledToolsForThread,
    getDefaultDisabledTools: mockGetDefaultDisabledTools,
  }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/components/ui/dropdrawer', () => ({
  DropDrawer: ({ children }: { children: React.ReactNode }) => <div data-testid="dropdrawer">{children}</div>,
  DropDrawerContent: ({ children }: { children: React.ReactNode }) => <div data-testid="dropdrawer-content">{children}</div>,
  DropDrawerItem: ({ children, disabled, icon }: { children: React.ReactNode; disabled?: boolean; icon?: React.ReactNode }) => (
    <div data-testid="dropdrawer-item" data-disabled={disabled}>
      {icon}
      {children}
    </div>
  ),
  DropDrawerSub: ({ children }: { children: React.ReactNode }) => <div data-testid="dropdrawer-sub">{children}</div>,
  DropDrawerLabel: ({ children }: { children: React.ReactNode }) => <div data-testid="dropdrawer-label">{children}</div>,
  DropDrawerSubContent: ({ children }: { children: React.ReactNode }) => <div data-testid="dropdrawer-sub-content">{children}</div>,
  DropDrawerSeparator: () => <hr data-testid="dropdrawer-separator" />,
  DropDrawerSubTrigger: ({ children }: { children: React.ReactNode }) => <div data-testid="dropdrawer-sub-trigger">{children}</div>,
  DropDrawerTrigger: ({ children }: { children: React.ReactNode }) => <div data-testid="dropdrawer-trigger">{children}</div>,
  DropDrawerGroup: ({ children }: { children: React.ReactNode }) => <div data-testid="dropdrawer-group">{children}</div>,
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked }: { checked: boolean }) => (
    <input type="checkbox" data-testid="switch" checked={checked} readOnly />
  ),
}))

import DropdownToolsAvailable from '../DropdownToolsAvailable'

describe('DropdownToolsAvailable', () => {
  const renderTrigger = (isOpen: boolean, toolsCount: number) => (
    <button data-testid="trigger">
      Tools ({toolsCount}) {isOpen ? 'open' : 'closed'}
    </button>
  )

  beforeEach(() => {
    vi.clearAllMocks()
    currentTools = mockTools
    mockIsToolDisabled.mockReturnValue(false)
    mockGetDisabledToolsForThread.mockReturnValue([])
    mockGetDefaultDisabledTools.mockReturnValue([])
  })

  it('renders "no tools available" when tools list is empty', () => {
    currentTools = []

    render(
      <DropdownToolsAvailable>{renderTrigger}</DropdownToolsAvailable>
    )

    expect(screen.getByText('common:noToolsAvailable')).toBeInTheDocument()
  })

  it('renders tool names grouped by server when tools exist', () => {
    render(
      <DropdownToolsAvailable>{renderTrigger}</DropdownToolsAvailable>
    )

    expect(screen.getByText('server-1')).toBeInTheDocument()
    expect(screen.getByText('server-2')).toBeInTheDocument()
    expect(screen.getByText('tool-a')).toBeInTheDocument()
    expect(screen.getByText('tool-b')).toBeInTheDocument()
    expect(screen.getByText('tool-c')).toBeInTheDocument()
  })

  it('renders "Available Tools" label', () => {
    render(
      <DropdownToolsAvailable>{renderTrigger}</DropdownToolsAvailable>
    )

    expect(screen.getByText('Available Tools')).toBeInTheDocument()
  })

  it('shows enabled tools count in trigger', () => {
    render(
      <DropdownToolsAvailable>{renderTrigger}</DropdownToolsAvailable>
    )

    // All 3 tools enabled since getDisabledToolsForThread returns []
    expect(screen.getByText('Tools (3) closed')).toBeInTheDocument()
  })

  it('shows reduced count when some tools are disabled', () => {
    mockGetDisabledToolsForThread.mockReturnValue([
      'server-1::tool-a',
    ])

    render(
      <DropdownToolsAvailable>{renderTrigger}</DropdownToolsAvailable>
    )

    expect(screen.getByText('Tools (2) closed')).toBeInTheDocument()
  })

  it('initializes thread tools on mount when tools and threadId exist', () => {
    render(
      <DropdownToolsAvailable>{renderTrigger}</DropdownToolsAvailable>
    )

    expect(mockInitializeThreadTools).toHaveBeenCalledWith(
      'thread-1',
      mockTools
    )
  })

  it('renders tool descriptions when provided', () => {
    render(
      <DropdownToolsAvailable>{renderTrigger}</DropdownToolsAvailable>
    )

    expect(screen.getByText('Description A')).toBeInTheDocument()
    expect(screen.getByText('Description B')).toBeInTheDocument()
  })

  it('renders "All Tools" toggle when server has more than 1 tool', () => {
    render(
      <DropdownToolsAvailable>{renderTrigger}</DropdownToolsAvailable>
    )

    // server-1 has 2 tools so "All Tools" should appear
    expect(screen.getByText('All Tools')).toBeInTheDocument()
  })

  it('shows enabled count per server', () => {
    render(
      <DropdownToolsAvailable>{renderTrigger}</DropdownToolsAvailable>
    )

    // server-1 has 2 enabled tools, server-2 has 1
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('uses default disabled tools when initialMessage is true', () => {
    mockGetDefaultDisabledTools.mockReturnValue(['server-1::tool-a'])

    render(
      <DropdownToolsAvailable initialMessage>
        {renderTrigger}
      </DropdownToolsAvailable>
    )

    // 2 tools enabled (tool-b, tool-c)
    expect(screen.getByText('Tools (2) closed')).toBeInTheDocument()
  })
})
