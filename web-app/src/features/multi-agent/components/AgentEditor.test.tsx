import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentEditor } from './AgentEditor'

vi.mock('@/features/models/hooks/useModelProvider', () => ({
  useModelProvider: () => ({
    providers: [
      {
        provider: 'openai',
        models: [{ id: 'gpt-4o', name: 'GPT-4o' }],
      },
    ],
  }),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

describe('AgentEditor', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    agent: null,
    onSave: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows Create Agent title when agent is null', () => {
    render(<AgentEditor {...defaultProps} />)
    expect(screen.getByRole('heading', { name: 'Create Agent' })).toBeInTheDocument()
  })

  it('shows Edit Agent title when agent is provided', () => {
    const agent = {
      id: 'agent-1',
      name: 'Test Agent',
      instructions: 'Do stuff',
      created_at: Date.now(),
      type: 'agent' as const,
    }
    render(<AgentEditor {...defaultProps} agent={agent} />)
    expect(screen.getByText('Edit Agent')).toBeInTheDocument()
  })

  it('populates form fields from provided agent', () => {
    const agent = {
      id: 'agent-1',
      name: 'Research Bot',
      role: 'Analyst',
      goal: 'Find data',
      instructions: 'Search the web',
      description: 'A helpful bot',
      created_at: Date.now(),
      type: 'agent' as const,
    }
    render(<AgentEditor {...defaultProps} agent={agent} />)

    expect(screen.getByPlaceholderText('Researcher')).toHaveValue(
      'Research Bot'
    )
    expect(
      screen.getByPlaceholderText('Senior Research Analyst')
    ).toHaveValue('Analyst')
  })

  it('disables Create Agent button when name is empty', () => {
    render(<AgentEditor {...defaultProps} />)
    const createBtn = screen.getByRole('button', { name: 'Create Agent' })
    expect(createBtn).toBeDisabled()
  })

  it('enables Create Agent button when name is entered', async () => {
    const user = userEvent.setup()
    render(<AgentEditor {...defaultProps} />)

    await user.type(screen.getByPlaceholderText('Researcher'), 'MyBot')
    const createBtn = screen.getByRole('button', { name: 'Create Agent' })
    expect(createBtn).not.toBeDisabled()
  })

  it('calls onSave with assembled agent data', async () => {
    const user = userEvent.setup()
    render(<AgentEditor {...defaultProps} />)

    await user.type(screen.getByPlaceholderText('Researcher'), 'MyBot')
    await user.type(
      screen.getByPlaceholderText('Instructions for this agent...'),
      'Be helpful'
    )
    await user.click(screen.getByRole('button', { name: 'Create Agent' }))

    expect(defaultProps.onSave).toHaveBeenCalledTimes(1)
    const saved = defaultProps.onSave.mock.calls[0][0]
    expect(saved.name).toBe('MyBot')
    expect(saved.instructions).toBe('Be helpful')
    expect(saved.type).toBe('agent')
  })

  it('calls onOpenChange(false) when Cancel is clicked', async () => {
    const user = userEvent.setup()
    render(<AgentEditor {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows tool access buttons', () => {
    render(<AgentEditor {...defaultProps} />)

    expect(screen.getByText('All Tools')).toBeInTheDocument()
    expect(screen.getByText('Only Selected')).toBeInTheDocument()
    expect(screen.getByText('All Except')).toBeInTheDocument()
  })

  it('shows tool keys input when non-all mode is selected', async () => {
    const user = userEvent.setup()
    render(<AgentEditor {...defaultProps} />)

    await user.click(screen.getByText('Only Selected'))
    expect(
      screen.getByPlaceholderText(
        'server::tool, server::tool2 (comma-separated)'
      )
    ).toBeInTheDocument()
  })

  it('shows Delete Agent button when onDelete and agent are provided', () => {
    const agent = {
      id: 'agent-1',
      name: 'Bot',
      instructions: '',
      created_at: Date.now(),
      type: 'agent' as const,
    }
    render(
      <AgentEditor {...defaultProps} agent={agent} onDelete={vi.fn()} />
    )

    expect(
      screen.getByRole('button', { name: 'Delete Agent' })
    ).toBeInTheDocument()
  })

  it('does not show Delete Agent button when no onDelete', () => {
    const agent = {
      id: 'agent-1',
      name: 'Bot',
      instructions: '',
      created_at: Date.now(),
      type: 'agent' as const,
    }
    render(<AgentEditor {...defaultProps} agent={agent} />)

    expect(
      screen.queryByRole('button', { name: 'Delete Agent' })
    ).not.toBeInTheDocument()
  })

  it('renders model override dropdown with provider models', () => {
    render(<AgentEditor {...defaultProps} />)

    const select = screen.getByDisplayValue("Default (use team's model)")
    expect(select).toBeInTheDocument()
  })

  it('shows optional agent checkbox', () => {
    render(<AgentEditor {...defaultProps} />)

    expect(
      screen.getByLabelText(
        'Optional agent (orchestrator may skip if not needed)'
      )
    ).toBeInTheDocument()
  })

  it('does not render when open is false', () => {
    render(<AgentEditor {...defaultProps} open={false} />)
    expect(screen.queryByTestId('dialog')).not.toBeInTheDocument()
  })
})
