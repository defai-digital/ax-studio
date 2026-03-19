import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TokenCounter } from '../TokenCounter'

// ── Mocks ────────────────────────────────────────────

const mockCalculateTokens = vi.fn()

const mockUseTokensCount = vi.fn(() => ({
  tokenCount: 500,
  maxTokens: 4096,
  percentage: 12.2,
  isNearLimit: false,
  loading: false,
  calculateTokens: mockCalculateTokens,
}))

vi.mock('@/hooks/useTokensCount', () => ({
  useTokensCount: (...args: unknown[]) => mockUseTokensCount(...args),
}))

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

// ── Tests ────────────────────────────────────────────

describe('TokenCounter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTokensCount.mockReturnValue({
      tokenCount: 500,
      maxTokens: 4096,
      percentage: 12.2,
      isNearLimit: false,
      loading: false,
      calculateTokens: mockCalculateTokens,
    })
  })

  it('renders percentage display', () => {
    render(<TokenCounter />)
    // Percentage appears in both main display and tooltip
    const percentages = screen.getAllByText('12.2%')
    expect(percentages.length).toBe(2)
  })

  it('renders the SVG progress circle', () => {
    const { container } = render(<TokenCounter />)
    const svgs = container.querySelectorAll('svg')
    expect(svgs.length).toBe(1)
    const circles = container.querySelectorAll('circle')
    expect(circles.length).toBe(2) // background + progress
  })

  it('calls calculateTokens when clicked', () => {
    render(<TokenCounter />)
    // The clickable div wraps the percentage display
    const percentages = screen.getAllByText('12.2%')
    const clickable = percentages[0].closest('[class*="cursor-pointer"]')
    expect(clickable).toBeInTheDocument()
    if (clickable) {
      fireEvent.click(clickable)
      expect(mockCalculateTokens).toHaveBeenCalledTimes(1)
    }
  })

  it('renders tooltip with token breakdown', () => {
    render(<TokenCounter />)
    expect(screen.getByText('Text')).toBeInTheDocument()
    expect(screen.getByText('Remaining')).toBeInTheDocument()
  })

  it('formats numbers with K suffix for thousands', () => {
    render(<TokenCounter />)
    // maxTokens = 4096, formatted as "4.1K" in the tooltip header
    expect(screen.getByText(/4\.1K/)).toBeInTheDocument()
  })

  it('shows additionalTokens in total calculation', () => {
    mockUseTokensCount.mockReturnValue({
      tokenCount: 3500,
      maxTokens: 4096,
      percentage: 85.4,
      isNearLimit: true,
      loading: false,
      calculateTokens: mockCalculateTokens,
    })

    render(<TokenCounter additionalTokens={500} />)
    // 3500 + 500 = 4000 out of 4096 = 97.65625 -> 97.7%
    const percentages = screen.getAllByText('97.7%')
    expect(percentages.length).toBe(2)
  })

  it('shows 0.0% when maxTokens is undefined', () => {
    mockUseTokensCount.mockReturnValue({
      tokenCount: 0,
      maxTokens: undefined,
      percentage: undefined,
      isNearLimit: false,
      loading: false,
      calculateTokens: mockCalculateTokens,
    })

    render(<TokenCounter />)
    const percentages = screen.getAllByText('0.0%')
    expect(percentages.length).toBe(2)
  })

  it('formats millions with M suffix', () => {
    mockUseTokensCount.mockReturnValue({
      tokenCount: 1500000,
      maxTokens: 2000000,
      percentage: 75,
      isNearLimit: false,
      loading: false,
      calculateTokens: mockCalculateTokens,
    })

    render(<TokenCounter />)
    // formatNumber: 1500000 -> "1.5M", 2000000 -> "2.0M"
    // These appear in the tooltip header: "1.5M / 2.0M"
    const headerText = screen.getByText(/1\.5M \/ 2\.0M/)
    expect(headerText).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(<TokenCounter className="custom-class" />)
    const wrapper = container.querySelector('.custom-class')
    expect(wrapper).toBeInTheDocument()
  })

  it('shows over-limit styling when percentage exceeds 100', () => {
    mockUseTokensCount.mockReturnValue({
      tokenCount: 5000,
      maxTokens: 4096,
      percentage: 122,
      isNearLimit: true,
      loading: false,
      calculateTokens: mockCalculateTokens,
    })

    render(<TokenCounter />)
    // 5000 / 4096 * 100 = 122.1%
    const percentages = screen.getAllByText('122.1%')
    expect(percentages.length).toBe(2)
  })
})
