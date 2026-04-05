import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Route as AgentTeamsRoute } from '../agent-teams'

vi.mock('@tanstack/react-router', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createFileRoute: () => (config: any) => ({
    ...config,
    component: config.component,
  }),
}))

vi.mock('@/constants/routes', () => ({
  route: {
    settings: {
      agent_teams: '/settings/agent-teams',
    },
  },
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="header-page">{children}</div>
  ),
}))

vi.mock('@/containers/SettingsMenu', () => ({
  default: () => <div data-testid="settings-menu">Settings Menu</div>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: {
    children: React.ReactNode
    onClick?: () => void
    [key: string]: unknown
  }) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    children,
    open,
  }: {
    children: React.ReactNode
    open: boolean
    onOpenChange?: (v: boolean) => void
  }) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2 data-testid="dialog-title">{children}</h2>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-footer">{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p data-testid="dialog-description">{children}</p>
  ),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@tabler/icons-react', () => ({
  IconCirclePlus: () => <span data-testid="icon-plus" />,
  IconPencil: () => <span data-testid="icon-pencil" />,
  IconTrash: () => <span data-testid="icon-trash" />,
  IconTemplate: () => <span data-testid="icon-template" />,
  IconCopy: () => <span data-testid="icon-copy" />,
  IconDownload: () => <span data-testid="icon-download" />,
  IconUpload: () => <span data-testid="icon-upload" />,
}))

vi.mock('lucide-react', () => ({
  Users: () => <span data-testid="icon-users" />,
}))

vi.mock('@/components/AgentTeamBuilder', () => ({
  AgentTeamBuilder: () => <div data-testid="agent-team-builder" />,
}))

vi.mock('@/lib/multi-agent/templates', () => ({
  TEMPLATES: [
    {
      name: 'Research Team',
      description: 'A team for research tasks',
      orchestration: { mode: 'sequential' },
      orchestrator_instructions: 'Coordinate research',
      agents: [
        {
          name: 'Researcher',
          role: 'researcher',
          goal: 'Do research',
          instructions: 'Research things',
        },
      ],
    },
  ],
}))

vi.mock('@/lib/multi-agent/cost-estimation', () => ({
  estimateTeamRunCost: vi.fn(() => ({
    range: { min: 1000, max: 5000 },
  })),
}))

const mockTeams = [
  {
    id: 'team-1',
    name: 'Alpha Team',
    description: 'First test team',
    orchestration: { mode: 'sequential' },
    agent_ids: ['agent-1', 'agent-2'],
    token_budget: 10000,
  },
  {
    id: 'team-2',
    name: 'Beta Team',
    description: 'Second test team',
    orchestration: { mode: 'parallel' },
    agent_ids: ['agent-3'],
  },
]

const mockCreateTeam = vi.fn()
const mockUpdateTeam = vi.fn()
const mockDeleteTeam = vi.fn()
const mockExportTeam = vi.fn()
const mockImportTeam = vi.fn()
const mockLoadTeams = vi.fn()

vi.mock('@/stores/agent-team-store', () => ({
  useAgentTeamStore: (selector: (state: unknown) => unknown) => {
    const state = {
      teams: mockTeams,
      isLoaded: true,
      loadTeams: mockLoadTeams,
      createTeam: mockCreateTeam,
      updateTeam: mockUpdateTeam,
      deleteTeam: mockDeleteTeam,
      exportTeam: mockExportTeam,
      importTeam: mockImportTeam,
    }
    return typeof selector === 'function' ? selector(state) : state
  },
}))

const mockAssistants = [
  { id: 'agent-1', name: 'Agent Alice' },
  { id: 'agent-2', name: 'Agent Bob' },
  { id: 'agent-3', name: 'Agent Charlie' },
]

const mockAddAssistant = vi.fn()

vi.mock('@/hooks/chat/useAssistant', () => ({
  useAssistant: () => ({
    assistants: mockAssistants,
    addAssistant: mockAddAssistant,
  }),
}))

describe('Agent Teams Settings Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the agent teams page', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Component = (AgentTeamsRoute as any)
      .component as React.ComponentType
    render(<Component />)

    expect(screen.getByTestId('header-page')).toBeInTheDocument()
    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
    expect(screen.getByText('common:agentTeams')).toBeInTheDocument()
  })

  it('renders team cards with names', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Component = (AgentTeamsRoute as any)
      .component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('Alpha Team')).toBeInTheDocument()
    expect(screen.getByText('Beta Team')).toBeInTheDocument()
  })

  it('displays orchestration mode labels', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Component = (AgentTeamsRoute as any)
      .component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('Sequential')).toBeInTheDocument()
    expect(screen.getByText('Parallel')).toBeInTheDocument()
  })

  it('displays agent count for each team', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Component = (AgentTeamsRoute as any)
      .component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('2 agents')).toBeInTheDocument()
    expect(screen.getByText('1 agent')).toBeInTheDocument()
  })

  it('displays agent names for each team', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Component = (AgentTeamsRoute as any)
      .component as React.ComponentType
    render(<Component />)

    expect(
      screen.getByText('Agents: Agent Alice, Agent Bob')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Agents: Agent Charlie')
    ).toBeInTheDocument()
  })

  it('shows "Unknown" for agents not found in assistants', () => {
    // Mock with a missing agent
    mockTeams[0].agent_ids = ['agent-1', 'missing-agent']

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Component = (AgentTeamsRoute as any)
      .component as React.ComponentType
    render(<Component />)

    expect(
      screen.getByText('Agents: Agent Alice, Unknown')
    ).toBeInTheDocument()

    // Restore
    mockTeams[0].agent_ids = ['agent-1', 'agent-2']
  })

  it('renders Create Team button', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Component = (AgentTeamsRoute as any)
      .component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('Create Team')).toBeInTheDocument()
  })

  it('renders Import and Template buttons', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Component = (AgentTeamsRoute as any)
      .component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('Import')).toBeInTheDocument()
    expect(screen.getByText('Template')).toBeInTheDocument()
  })

  it('shows team description', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Component = (AgentTeamsRoute as any)
      .component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('First test team')).toBeInTheDocument()
    expect(screen.getByText('Second test team')).toBeInTheDocument()
  })

  it('renders action buttons for each team (edit, delete, duplicate, export)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Component = (AgentTeamsRoute as any)
      .component as React.ComponentType
    render(<Component />)

    // Each team has 4 action buttons: export, duplicate, edit, delete
    const editButtons = screen.getAllByTitle('Edit team')
    expect(editButtons.length).toBe(2)

    const deleteButtons = screen.getAllByTitle('Delete team')
    expect(deleteButtons.length).toBe(2)

    const duplicateButtons = screen.getAllByTitle('Duplicate team')
    expect(duplicateButtons.length).toBe(2)

    const exportButtons = screen.getAllByTitle('Export team')
    expect(exportButtons.length).toBe(2)
  })

  it('shows token budget when configured', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Component = (AgentTeamsRoute as any)
      .component as React.ComponentType
    render(<Component />)

    // Alpha Team has token_budget of 10000
    expect(screen.getByText(/10,000 budget/)).toBeInTheDocument()
  })
})
