import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MermaidError } from './MermaidError'

// ── Mocks ────────────────────────────────────────────

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>()
  return { ...actual }
})

// ── Tests ────────────────────────────────────────────

describe('MermaidError', () => {
  const defaultProps = {
    error: 'Parse error on line 3',
    chart: 'graph TD\n  A-->B\n  INVALID',
    retry: vi.fn(),
    messageId: 'msg-1',
  }

  it('renders the error heading', () => {
    render(<MermaidError {...defaultProps} />)
    expect(screen.getByText('Diagram failed to render')).toBeInTheDocument()
  })

  it('displays the error message text', () => {
    render(<MermaidError {...defaultProps} />)
    expect(screen.getByText('Parse error on line 3')).toBeInTheDocument()
  })

  it('renders Retry button', () => {
    render(<MermaidError {...defaultProps} />)
    expect(screen.getByText('Retry')).toBeInTheDocument()
  })

  it('calls retry callback when Retry button is clicked', () => {
    const retry = vi.fn()
    render(<MermaidError {...defaultProps} retry={retry} />)
    fireEvent.click(screen.getByText('Retry'))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('does not show chart source by default', () => {
    render(<MermaidError {...defaultProps} />)
    expect(screen.queryByText(defaultProps.chart)).not.toBeInTheDocument()
    expect(screen.getByText('Show source')).toBeInTheDocument()
  })

  it('toggles chart source visibility when Show/Hide source is clicked', () => {
    const { container } = render(<MermaidError {...defaultProps} />)

    // Click to show
    fireEvent.click(screen.getByText('Show source'))
    expect(container.querySelector('pre')).toBeInTheDocument()
    expect(screen.getByText('Hide source')).toBeInTheDocument()

    // Click to hide
    fireEvent.click(screen.getByText('Hide source'))
    expect(container.querySelector('pre')).not.toBeInTheDocument()
    expect(screen.getByText('Show source')).toBeInTheDocument()
  })

  it('renders different error messages correctly', () => {
    const { rerender } = render(<MermaidError {...defaultProps} />)
    expect(screen.getByText('Parse error on line 3')).toBeInTheDocument()

    rerender(
      <MermaidError {...defaultProps} error="Syntax error: unexpected token" />
    )
    expect(
      screen.getByText('Syntax error: unexpected token')
    ).toBeInTheDocument()
  })

  it('renders chart content in a pre element when source is shown', () => {
    const { container } = render(<MermaidError {...defaultProps} />)
    fireEvent.click(screen.getByText('Show source'))
    const preElement = container.querySelector('pre')
    expect(preElement).toBeInTheDocument()
    expect(preElement?.tagName).toBe('PRE')
    expect(preElement?.textContent).toBe(defaultProps.chart)
  })
})
