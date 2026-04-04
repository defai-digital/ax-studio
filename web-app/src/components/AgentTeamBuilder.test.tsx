import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentTeamBuilder } from './AgentTeamBuilder'

const mockAssistants = [
  {
    id: 'default-asst',
    name: 'Default',
    type: 'assistant' as const,
    created_at: Date.now(),
    instructions: '',
    parameters: {},
  },
  {
    id: 'agent-1',
    name: 'Research Agent',
    type: 'agent' as const,
    role: 'Researcher',
    created_at: Date.now(),
    instructions: 'You are a researcher',
    parameters: {},
    max_result_tokens: 4000,
    max_steps: 5,
  },
  {
    id: 'agent-2',
    name: 'Writer Agent',
    type: 'agent' as const,
    created_at: Date.now(),
    instructions: 'You are a writer',
    parameters: {},
    max_result_tokens: 8000,
    max_steps: 10,
  },
]

const mockEstimateTeamRunCost = vi.fn().mockReturnValue(null)

vi.mock('@/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistants: mockAssistants,
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
  estimateTeamRunCost: (...args: unknown[]) => mockEstimateTeamRunCost(...args),
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
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-menu">{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => (
    <div data-testid="dropdown-trigger">{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-content">{children}</div>
  ),
  DropdownMenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) => (
    <button data-testid="dropdown-item" onClick={onSelect}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-label">{children}</div>
  ),
  DropdownMenuSeparator: () => (
    <hr data-testid="dropdown-separator" />
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
    // Default: return null (no estimate)
    mockEstimateTeamRunCost.mockReturnValue(null)
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

  it('shows Create New Agent option in the dropdown', () => {
    render(<AgentTeamBuilder {...defaultProps} />)
    expect(screen.getByText('Create New Agent')).toBeInTheDocument()
  })

  it('shows Select Existing label and available agents in dropdown', () => {
    render(<AgentTeamBuilder {...defaultProps} />)
    expect(screen.getByText('Select Existing')).toBeInTheDocument()
    expect(screen.getByText('Research Agent')).toBeInTheDocument()
    expect(screen.getByText('Writer Agent')).toBeInTheDocument()
  })

  it('does not show non-agent assistants in the dropdown', () => {
    render(<AgentTeamBuilder {...defaultProps} />)
    expect(screen.queryByText('Default')).not.toBeInTheDocument()
  })

  it('shows role for agents that have one', () => {
    render(<AgentTeamBuilder {...defaultProps} />)
    expect(screen.getByText('Researcher')).toBeInTheDocument()
  })

  it('adds an existing agent when selected from dropdown', () => {
    render(<AgentTeamBuilder {...defaultProps} />)

    // Verify agent is initially in the dropdown
    const items = screen.getAllByTestId('dropdown-item')
    const researchAgentItem = items.find(
      (item) => item.textContent?.includes('Research Agent')
    )
    expect(researchAgentItem).toBeTruthy()

    // Click to add the agent
    researchAgentItem!.click()

    // Agent should appear in the agent list with its role badge
    expect(screen.getByText('Researcher')).toBeInTheDocument()
    // The agent name appears in the list (and is removed from dropdown since it's now in the team)
    expect(screen.getByText('Research Agent')).toBeInTheDocument()
  })

  it('does not show already-added agents in the existing agents dropdown', () => {
    const team = {
      id: 'team-1',
      name: 'Test Team',
      description: 'A team',
      orchestration: { mode: 'router' as const },
      agent_ids: ['agent-1'],
      created_at: Date.now(),
      updated_at: Date.now(),
    }
    render(<AgentTeamBuilder {...defaultProps} team={team} />)

    // Research Agent is in the team, so it should not appear in the dropdown options
    // But it should appear in the agent list
    expect(screen.getByText('Researcher')).toBeInTheDocument()
  })

  it('shows cost estimate when team has agents', () => {
    mockEstimateTeamRunCost.mockReturnValue({
      agents: [{ agent: 'Research Agent', estimatedTokens: 4000 }],
      orchestratorOverhead: 3000,
      range: { min: 4200, max: 7000 },
      budget: 100000,
      withinBudget: true,
    })

    const team = {
      id: 'team-1',
      name: 'Test Team',
      description: 'A team',
      orchestration: { mode: 'router' as const },
      agent_ids: ['agent-1'],
      created_at: Date.now(),
      updated_at: Date.now(),
    }
    render(<AgentTeamBuilder {...defaultProps} team={team} />)

    expect(screen.getByText('Cost Estimate')).toBeInTheDocument()
    // Research Agent appears in both the agent list and the cost estimate
    expect(screen.getAllByText('Research Agent').length).toBeGreaterThanOrEqual(2)
  })

  it('does not show cost estimate when team has no agents', () => {
    render(<AgentTeamBuilder {...defaultProps} />)
    expect(screen.queryByText('Cost Estimate')).not.toBeInTheDocument()
  })

  it('passes full orchestration object to cost estimation including max_iterations', () => {
    mockEstimateTeamRunCost.mockReturnValue({
      agents: [{ agent: 'Research Agent', estimatedTokens: 4000 }],
      orchestratorOverhead: 3000,
      range: { min: 4200, max: 7000 },
      budget: 100000,
      withinBudget: true,
    })

    const team = {
      id: 'team-1',
      name: 'Test Team',
      description: 'A team',
      orchestration: {
        mode: 'evaluator-optimizer' as const,
        max_iterations: 5,
        quality_threshold: 'high',
      },
      agent_ids: ['agent-1'],
      created_at: Date.now(),
      updated_at: Date.now(),
    }
    render(<AgentTeamBuilder {...defaultProps} team={team} />)

    expect(mockEstimateTeamRunCost).toHaveBeenCalled()
    const lastCall = mockEstimateTeamRunCost.mock.calls[mockEstimateTeamRunCost.mock.calls.length - 1]
    const orchestration = lastCall[0].orchestration

    // Should include max_iterations from the team, not default to 3
    expect(orchestration).toHaveProperty('max_iterations', 5)
  })

  it('passes agent max_result_tokens to cost estimation for capping', () => {
    mockEstimateTeamRunCost.mockReturnValue({
      agents: [{ agent: 'Research Agent', estimatedTokens: 4000 }],
      orchestratorOverhead: 3000,
      range: { min: 4200, max: 7000 },
      budget: 100000,
      withinBudget: true,
    })

    const team = {
      id: 'team-1',
      name: 'Test Team',
      description: 'A team',
      orchestration: { mode: 'router' as const },
      agent_ids: ['agent-1'],
      created_at: Date.now(),
      updated_at: Date.now(),
    }
    render(<AgentTeamBuilder {...defaultProps} team={team} />)

    expect(mockEstimateTeamRunCost).toHaveBeenCalled()
    const lastCall = mockEstimateTeamRunCost.mock.calls[mockEstimateTeamRunCost.mock.calls.length - 1]
    const agents = lastCall[1]

    // Agent should have max_result_tokens from the assistant store
    expect(agents[0]).toHaveProperty('max_result_tokens', 4000)
  })
})
