import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CostApprovalModal } from './CostApprovalModal'
import type { CostEstimate } from '@/lib/multi-agent/cost-estimation'

// ── Mocks ────────────────────────────────────────────

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>()
  return { ...actual }
})

// ── Helpers ──────────────────────────────────────────

function makeEstimate(overrides?: Partial<CostEstimate>): CostEstimate {
  return {
    agents: [
      { agent: 'Researcher', estimatedTokens: 15000 },
      { agent: 'Writer', estimatedTokens: 12000 },
    ],
    orchestratorOverhead: 3000,
    range: { min: 25000, max: 35000 },
    budget: 50000,
    withinBudget: true,
    ...overrides,
  }
}

// ── Tests ────────────────────────────────────────────

describe('CostApprovalModal', () => {
  const defaultProps = {
    open: true,
    estimate: makeEstimate(),
    onApprove: vi.fn(),
    onCancel: vi.fn(),
  }

  it('renders the dialog title when open', () => {
    render(<CostApprovalModal {...defaultProps} />)
    expect(
      screen.getByText('Cost Estimate Exceeds Threshold')
    ).toBeInTheDocument()
  })

  it('renders the description text', () => {
    render(<CostApprovalModal {...defaultProps} />)
    expect(
      screen.getByText(/estimated token usage.*exceeds your/i)
    ).toBeInTheDocument()
  })

  it('displays agent names in the breakdown', () => {
    render(<CostApprovalModal {...defaultProps} />)
    expect(screen.getByText('Researcher')).toBeInTheDocument()
    expect(screen.getByText('Writer')).toBeInTheDocument()
  })

  it('displays agent estimated tokens formatted with locale', () => {
    render(<CostApprovalModal {...defaultProps} />)
    // 15000 tokens -> "~15,000 tokens"
    expect(screen.getByText('~15,000 tokens')).toBeInTheDocument()
    expect(screen.getByText('~12,000 tokens')).toBeInTheDocument()
  })

  it('displays orchestrator overhead', () => {
    render(<CostApprovalModal {...defaultProps} />)
    expect(screen.getByText('Orchestrator overhead')).toBeInTheDocument()
    expect(screen.getByText('~3,000 tokens')).toBeInTheDocument()
  })

  it('displays estimated range', () => {
    render(<CostApprovalModal {...defaultProps} />)
    expect(screen.getByText('Estimated range')).toBeInTheDocument()
    // The range uses &ndash; (–)
    expect(screen.getByText(/25,000/)).toBeInTheDocument()
    expect(screen.getByText(/35,000/)).toBeInTheDocument()
  })

  it('displays budget', () => {
    render(<CostApprovalModal {...defaultProps} />)
    expect(screen.getByText('Budget')).toBeInTheDocument()
    expect(screen.getByText('50,000 tokens')).toBeInTheDocument()
  })

  it('calls onApprove when Proceed button is clicked', () => {
    const onApprove = vi.fn()
    render(<CostApprovalModal {...defaultProps} onApprove={onApprove} />)
    fireEvent.click(screen.getByText('Proceed'))
    expect(onApprove).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when Cancel button is clicked', () => {
    const onCancel = vi.fn()
    render(<CostApprovalModal {...defaultProps} onCancel={onCancel} />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('does not render content when open is false', () => {
    render(<CostApprovalModal {...defaultProps} open={false} />)
    expect(
      screen.queryByText('Cost Estimate Exceeds Threshold')
    ).not.toBeInTheDocument()
  })

  it('renders with a single agent', () => {
    const estimate = makeEstimate({
      agents: [{ agent: 'Solo Agent', estimatedTokens: 5000 }],
    })
    render(<CostApprovalModal {...defaultProps} estimate={estimate} />)
    expect(screen.getByText('Solo Agent')).toBeInTheDocument()
    expect(screen.getByText('~5,000 tokens')).toBeInTheDocument()
  })

  it('renders with large token values', () => {
    const estimate = makeEstimate({
      agents: [{ agent: 'Big Agent', estimatedTokens: 1500000 }],
      orchestratorOverhead: 500000,
      range: { min: 1800000, max: 2500000 },
      budget: 3000000,
    })
    render(<CostApprovalModal {...defaultProps} estimate={estimate} />)
    expect(screen.getByText('~1,500,000 tokens')).toBeInTheDocument()
    expect(screen.getByText('3,000,000 tokens')).toBeInTheDocument()
  })
})
