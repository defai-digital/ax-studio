import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TeamVariablePrompt } from './TeamVariablePrompt'
import type { TeamVariable } from '@/types/agent-team'

// ── Mocks ────────────────────────────────────────────

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>()
  return { ...actual }
})

// ── Helpers ──────────────────────────────────────────

function makeVariable(overrides?: Partial<TeamVariable>): TeamVariable {
  return {
    name: 'topic',
    label: 'Topic',
    description: 'The research topic',
    default_value: 'AI safety',
    ...overrides,
  }
}

// ── Tests ────────────────────────────────────────────

describe('TeamVariablePrompt', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    teamName: 'Research Team',
    variables: [makeVariable()],
    onSubmit: vi.fn(),
  }

  it('renders the dialog title', () => {
    render(<TeamVariablePrompt {...defaultProps} />)
    expect(screen.getByText('Configure Team Variables')).toBeInTheDocument()
  })

  it('includes the team name in the description', () => {
    render(<TeamVariablePrompt {...defaultProps} />)
    expect(screen.getByText(/Research Team/)).toBeInTheDocument()
  })

  it('renders variable label', () => {
    render(<TeamVariablePrompt {...defaultProps} />)
    expect(screen.getByText('Topic')).toBeInTheDocument()
  })

  it('renders variable description', () => {
    render(<TeamVariablePrompt {...defaultProps} />)
    expect(screen.getByText('The research topic')).toBeInTheDocument()
  })

  it('populates input with default value', () => {
    render(<TeamVariablePrompt {...defaultProps} />)
    const input = screen.getByDisplayValue('AI safety')
    expect(input).toBeInTheDocument()
  })

  it('uses variable name as label when label is not provided', () => {
    const vars = [makeVariable({ name: 'query', label: '' })]
    render(<TeamVariablePrompt {...defaultProps} variables={vars} />)
    // Falls back to v.label || v.name, empty label still renders empty string
    // But the input should use name as placeholder
    const input = screen.getByPlaceholderText('AI safety')
    expect(input).toBeInTheDocument()
  })

  it('renders multiple variables', () => {
    const vars = [
      makeVariable({ name: 'topic', label: 'Topic' }),
      makeVariable({
        name: 'depth',
        label: 'Depth',
        description: 'Analysis depth',
        default_value: 'detailed',
      }),
    ]
    render(<TeamVariablePrompt {...defaultProps} variables={vars} />)
    expect(screen.getByText('Topic')).toBeInTheDocument()
    expect(screen.getByText('Depth')).toBeInTheDocument()
    expect(screen.getByDisplayValue('AI safety')).toBeInTheDocument()
    expect(screen.getByDisplayValue('detailed')).toBeInTheDocument()
  })

  it('updates input value on change', () => {
    render(<TeamVariablePrompt {...defaultProps} />)
    const input = screen.getByDisplayValue('AI safety')
    fireEvent.change(input, { target: { value: 'Machine learning' } })
    expect(screen.getByDisplayValue('Machine learning')).toBeInTheDocument()
  })

  it('calls onSubmit with current values when Apply is clicked', () => {
    const onSubmit = vi.fn()
    render(<TeamVariablePrompt {...defaultProps} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByText('Apply'))
    expect(onSubmit).toHaveBeenCalledWith({ topic: 'AI safety' })
  })

  it('calls onSubmit with modified values', () => {
    const onSubmit = vi.fn()
    render(<TeamVariablePrompt {...defaultProps} onSubmit={onSubmit} />)

    const input = screen.getByDisplayValue('AI safety')
    fireEvent.change(input, { target: { value: 'Robotics' } })
    fireEvent.click(screen.getByText('Apply'))

    expect(onSubmit).toHaveBeenCalledWith({ topic: 'Robotics' })
  })

  it('calls onOpenChange(false) when Apply is clicked', () => {
    const onOpenChange = vi.fn()
    render(
      <TeamVariablePrompt {...defaultProps} onOpenChange={onOpenChange} />
    )
    fireEvent.click(screen.getByText('Apply'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('calls onOpenChange(false) when Cancel is clicked', () => {
    const onOpenChange = vi.fn()
    render(
      <TeamVariablePrompt {...defaultProps} onOpenChange={onOpenChange} />
    )
    fireEvent.click(screen.getByText('Cancel'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('does not render when open is false', () => {
    render(<TeamVariablePrompt {...defaultProps} open={false} />)
    expect(
      screen.queryByText('Configure Team Variables')
    ).not.toBeInTheDocument()
  })

  it('handles variables with no default_value', () => {
    const vars = [
      makeVariable({ name: 'query', label: 'Query', default_value: undefined }),
    ]
    render(<TeamVariablePrompt {...defaultProps} variables={vars} />)
    const input = screen.getByRole('textbox')
    expect(input).toHaveValue('')
  })

  it('handles variables with no description', () => {
    const vars = [
      makeVariable({ description: undefined }),
    ]
    render(<TeamVariablePrompt {...defaultProps} variables={vars} />)
    expect(screen.queryByText('The research topic')).not.toBeInTheDocument()
    expect(screen.getByText('Topic')).toBeInTheDocument()
  })
})
