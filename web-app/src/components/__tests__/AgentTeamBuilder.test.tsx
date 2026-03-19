import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentTeamBuilder } from '../AgentTeamBuilder'

vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistants: [],
    addAssistant: vi.fn(),
    updateAssistant: vi.fn(),
  }),
}))

vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: () => ({
    providers: [],
  }),
}))

vi.mock('@/lib/multi-agent/cost-estimation', () => ({
  estimateTeamRunCost: vi.fn().mockReturnValue(null),
}))

vi.mock('@/components/AgentEditor', () => ({
  AgentEditor: () => <div data-testid="agent-editor" />,
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
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

describe('AgentTeamBuilder', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    team: null,
    onSave: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows Create Agent Team title when team is null', () => {
    render(<AgentTeamBuilder {...defaultProps} />)
    expect(screen.getByText('Create Agent Team')).toBeInTheDocument()
  })

  it('shows Edit Agent Team title when team is provided', () => {
    const team = {
      id: 'team-1',
      name: 'Test Team',
      description: 'A team',
      orchestration: { mode: 'router' as const },
      agent_ids: [],
      created_at: Date.now(),
      updated_at: Date.now(),
    }
    render(<AgentTeamBuilder {...defaultProps} team={team} />)
    expect(screen.getByText('Edit Agent Team')).toBeInTheDocument()
  })

  it('renders all four orchestration mode buttons', () => {
    render(<AgentTeamBuilder {...defaultProps} />)

    expect(screen.getByText('Router')).toBeInTheDocument()
    expect(screen.getByText('Sequential')).toBeInTheDocument()
    expect(screen.getByText('Parallel')).toBeInTheDocument()
    expect(screen.getByText('Evaluator-Optimizer')).toBeInTheDocument()
  })

  it('disables Create Team when name is empty or no agents', () => {
    render(<AgentTeamBuilder {...defaultProps} />)
    const createBtn = screen.getByRole('button', { name: 'Create Team' })
    expect(createBtn).toBeDisabled()
  })

  it('shows empty agents message', () => {
    render(<AgentTeamBuilder {...defaultProps} />)
    expect(
      screen.getByText(/No agents added yet/)
    ).toBeInTheDocument()
  })

  it('calls onOpenChange(false) when Cancel is clicked', async () => {
    const user = userEvent.setup()
    render(<AgentTeamBuilder {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('shows evaluator-optimizer specific fields when mode is selected', async () => {
    const user = userEvent.setup()
    render(<AgentTeamBuilder {...defaultProps} />)

    await user.click(screen.getByText('Evaluator-Optimizer'))
    expect(screen.getByText('Max Iterations')).toBeInTheDocument()
    expect(screen.getByText('Quality Threshold')).toBeInTheDocument()
  })

  it('shows stagger delay when parallel mode is selected', async () => {
    const user = userEvent.setup()
    render(<AgentTeamBuilder {...defaultProps} />)

    await user.click(screen.getByText('Parallel'))
    expect(screen.getByText('Stagger Delay (ms)')).toBeInTheDocument()
  })

  it('does not render when open is false', () => {
    render(<AgentTeamBuilder {...defaultProps} open={false} />)
    expect(screen.queryByTestId('dialog')).not.toBeInTheDocument()
  })

  it('renders Add Variable button', () => {
    render(<AgentTeamBuilder {...defaultProps} />)
    expect(
      screen.getByRole('button', { name: /Add Variable/i })
    ).toBeInTheDocument()
  })
})
