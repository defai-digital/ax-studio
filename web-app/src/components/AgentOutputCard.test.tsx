import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentOutputCard } from './AgentOutputCard'

// ── Mocks ────────────────────────────────────────────

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>()
  return { ...actual }
})

// ── Tests ────────────────────────────────────────────

describe('AgentOutputCard', () => {
  const baseProps = {
    agentName: 'Research Agent',
    status: 'complete' as const,
    tokensUsed: 1500,
  }

  // Phase 1: Basic rendering

  it('renders agent name', () => {
    render(<AgentOutputCard {...baseProps} />)
    expect(screen.getByText('Research Agent')).toBeInTheDocument()
  })

  it('renders agent role when provided', () => {
    render(<AgentOutputCard {...baseProps} agentRole="analyst" />)
    expect(screen.getByText('analyst')).toBeInTheDocument()
  })

  it('does not render role badge when agentRole is not provided', () => {
    const { container } = render(<AgentOutputCard {...baseProps} />)
    // The role badge has bg-muted class
    const roleBadges = container.querySelectorAll('.bg-muted')
    expect(roleBadges.length).toBe(0)
  })

  it('renders token count when tokensUsed > 0', () => {
    render(<AgentOutputCard {...baseProps} tokensUsed={2500} />)
    expect(screen.getByText('2,500 tokens')).toBeInTheDocument()
  })

  it('does not render token count when tokensUsed is 0', () => {
    render(<AgentOutputCard {...baseProps} tokensUsed={0} />)
    expect(screen.queryByText(/tokens$/)).not.toBeInTheDocument()
  })

  // Phase 2: Status rendering

  it('renders Complete status indicator for complete status', () => {
    const { container } = render(<AgentOutputCard {...baseProps} />)
    // complete status has text-green-500 class
    const greenElements = container.querySelectorAll('.text-green-500')
    expect(greenElements.length).toBeGreaterThan(0)
  })

  it('renders running status with blue color', () => {
    const { container } = render(
      <AgentOutputCard {...baseProps} status="running" />
    )
    const blueElements = container.querySelectorAll('.text-blue-500')
    expect(blueElements.length).toBeGreaterThan(0)
  })

  it('renders error status with red color', () => {
    const { container } = render(
      <AgentOutputCard {...baseProps} status="error" />
    )
    const redElements = container.querySelectorAll('.text-red-500')
    expect(redElements.length).toBeGreaterThan(0)
  })

  // Phase 3: Tool calls display

  it('shows tool call count in header', () => {
    render(
      <AgentOutputCard
        {...baseProps}
        toolCalls={[
          { name: 'search', args: { q: 'test' } },
          { name: 'fetch', args: { url: 'http://example.com' } },
        ]}
      />
    )
    expect(screen.getByText('2 tool calls')).toBeInTheDocument()
  })

  it('shows singular "tool call" for a single tool', () => {
    render(
      <AgentOutputCard
        {...baseProps}
        toolCalls={[{ name: 'search', args: {} }]}
      />
    )
    expect(screen.getByText('1 tool call')).toBeInTheDocument()
  })

  it('shows tool calls section with expand toggle', () => {
    render(
      <AgentOutputCard
        {...baseProps}
        toolCalls={[{ name: 'search', args: { q: 'test' } }]}
      />
    )
    expect(screen.getByText('Tools used (1)')).toBeInTheDocument()
  })

  it('expands tool calls to show tool details', () => {
    render(
      <AgentOutputCard
        {...baseProps}
        toolCalls={[{ name: 'web_search', args: { query: 'vitest' } }]}
      />
    )

    fireEvent.click(screen.getByText('Tools used (1)'))
    expect(screen.getByText('web_search')).toBeInTheDocument()
  })

  // Phase 4: Error display

  it('shows error message when error prop is provided', () => {
    render(
      <AgentOutputCard
        {...baseProps}
        status="error"
        error="Rate limit exceeded"
      />
    )
    expect(screen.getByText('Rate limit exceeded')).toBeInTheDocument()
  })

  // Phase 5: Collapse behavior

  it('starts collapsed when isCollapsed is true', () => {
    render(
      <AgentOutputCard
        {...baseProps}
        isCollapsed={true}
        error="Some error"
      />
    )
    // When collapsed, the error detail should not be visible
    expect(screen.queryByText('Some error')).not.toBeInTheDocument()
  })

  it('toggles collapse on header click', () => {
    render(
      <AgentOutputCard
        {...baseProps}
        error="Toggle error"
      />
    )
    // Initially expanded - error visible
    expect(screen.getByText('Toggle error')).toBeInTheDocument()

    // Click header to collapse
    fireEvent.click(screen.getByText('Research Agent'))
    expect(screen.queryByText('Toggle error')).not.toBeInTheDocument()

    // Click again to expand
    fireEvent.click(screen.getByText('Research Agent'))
    expect(screen.getByText('Toggle error')).toBeInTheDocument()
  })

  // Phase 5: Output display

  it('shows agent output section when output is provided', () => {
    render(
      <AgentOutputCard {...baseProps} output="The analysis is complete." />
    )
    expect(screen.getByText('Agent output')).toBeInTheDocument()
  })

  it('expands agent output on click', () => {
    render(
      <AgentOutputCard {...baseProps} output="The analysis is complete." />
    )

    fireEvent.click(screen.getByText('Agent output'))
    expect(screen.getByText('The analysis is complete.')).toBeInTheDocument()
  })

  it('does not show details section when no error, toolCalls, or output', () => {
    render(<AgentOutputCard {...baseProps} />)
    expect(screen.queryByText('Tools used')).not.toBeInTheDocument()
    expect(screen.queryByText('Agent output')).not.toBeInTheDocument()
  })

  it('truncates long tool call arguments to 200 characters', () => {
    const longArgs = 'x'.repeat(300)
    render(
      <AgentOutputCard
        {...baseProps}
        toolCalls={[{ name: 'tool1', args: longArgs }]}
      />
    )
    // Expand tool calls
    fireEvent.click(screen.getByText('Tools used (1)'))
    // The displayed text should end with '...' for long args
    const pre = screen.getByText(/x+\.\.\./)
    expect(pre).toBeInTheDocument()
  })
})
