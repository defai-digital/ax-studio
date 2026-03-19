import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeToggle } from '../ThemeToggle'

// ── Mocks ────────────────────────────────────────────

const mockSetTheme = vi.fn()
let mockActiveTheme: 'light' | 'dark' | 'auto' = 'light'

// useTheme is a zustand store — calling it with no args returns full state
vi.mock('@/hooks/useTheme', () => {
  const store = () => ({
    activeTheme: mockActiveTheme,
    setTheme: mockSetTheme,
    isDark: mockActiveTheme === 'dark',
    setIsDark: vi.fn(),
  })
  // Zustand stores are also callable with a selector
  store.getState = store
  return { useTheme: store }
})

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>()
  return { ...actual }
})

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
  TooltipTrigger: ({
    children,
  }: {
    children: React.ReactNode
    asChild?: boolean
  }) => <>{children}</>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

vi.mock('motion/react', () => ({
  motion: {
    div: ({
      children,
      className,
      ...rest
    }: {
      children: React.ReactNode
      className?: string
    }) => (
      <div className={className} {...rest}>
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

// ── Tests ────────────────────────────────────────────

describe('ThemeToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockActiveTheme = 'light'
  })

  it('renders the main toggle button', () => {
    render(<ThemeToggle />)
    // There should be at least one button rendered
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(1)
  })

  it('cycles from light to dark on click', () => {
    render(<ThemeToggle />)
    // The last button is the main cycle button
    const buttons = screen.getAllByRole('button')
    const mainButton = buttons[buttons.length - 1]
    fireEvent.click(mainButton)

    expect(mockSetTheme).toHaveBeenCalledWith('dark')
  })

  it('cycles from dark to auto on click', () => {
    mockActiveTheme = 'dark'

    render(<ThemeToggle />)
    const buttons = screen.getAllByRole('button')
    const mainButton = buttons[buttons.length - 1]
    fireEvent.click(mainButton)

    expect(mockSetTheme).toHaveBeenCalledWith('auto')
  })

  it('cycles from auto to light on click', () => {
    mockActiveTheme = 'auto'

    render(<ThemeToggle />)
    const buttons = screen.getAllByRole('button')
    const mainButton = buttons[buttons.length - 1]
    fireEvent.click(mainButton)

    expect(mockSetTheme).toHaveBeenCalledWith('light')
  })

  it('displays tooltip content with current mode label', () => {
    render(<ThemeToggle />)
    // The tooltip renders "{label} mode" as a span
    expect(screen.getByText(/Light mode/)).toBeInTheDocument()
  })

  it('shows expand hint in tooltip', () => {
    render(<ThemeToggle />)
    expect(
      screen.getByText(/Click to cycle · Double-click to expand/)
    ).toBeInTheDocument()
  })

  it('toggles expanded panel on double-click', () => {
    render(<ThemeToggle />)
    const buttons = screen.getAllByRole('button')
    const mainButton = buttons[buttons.length - 1]

    fireEvent.doubleClick(mainButton)

    // After expanding, the 3 theme option buttons should appear (Light, Dark, System)
    // plus the main button = at least 4 buttons
    const allButtons = screen.getAllByRole('button')
    expect(allButtons.length).toBeGreaterThanOrEqual(4)
  })

  it('sets specific theme when expanded option is clicked', () => {
    render(<ThemeToggle />)
    const buttons = screen.getAllByRole('button')
    const mainButton = buttons[buttons.length - 1]

    // Expand panel
    fireEvent.doubleClick(mainButton)

    // The expanded panel should show Light, Dark, System labels in tooltips
    // Find all buttons again and click the second one (Dark)
    const allButtons = screen.getAllByRole('button')
    // The first 3 buttons (in the expanded panel) correspond to light, dark, auto
    fireEvent.click(allButtons[1]) // dark
    expect(mockSetTheme).toHaveBeenCalledWith('dark')
  })
})
