import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useAgentTeamStore } from './agent-team-store'
import type { AgentTeam } from '@/types/agent-team'

const mockInvoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

const makeTeam = (overrides: Partial<AgentTeam> = {}): AgentTeam => ({
  id: 'team-1',
  name: 'Test Team',
  description: 'A test team',
  orchestration: { mode: 'router' },
  agent_ids: [],
  created_at: 1000,
  updated_at: 1000,
  ...overrides,
})

const makeAssistant = (id: string, name: string): Assistant => ({
  id,
  name,
  avatar: '',
  created_at: 1000,
  instructions: '',
  parameters: {},
  type: 'agent',
})

beforeEach(() => {
  useAgentTeamStore.setState({ teams: [], isLoaded: false })
  mockInvoke.mockReset()
})

describe('useAgentTeamStore — initial state', () => {
  it('starts with empty teams and isLoaded false', () => {
    const state = useAgentTeamStore.getState()
    expect(state.teams).toEqual([])
    expect(state.isLoaded).toBe(false)
  })
})

describe('loadTeams', () => {
  it('loads teams and sets isLoaded true', async () => {
    const raw = [makeTeam()]
    mockInvoke.mockResolvedValue(raw)
    await useAgentTeamStore.getState().loadTeams()
    const state = useAgentTeamStore.getState()
    expect(state.teams).toHaveLength(1)
    expect(state.isLoaded).toBe(true)
  })

  it('normalizes teams missing orchestration field', async () => {
    const raw = [{ ...makeTeam(), orchestration: undefined }]
    mockInvoke.mockResolvedValue(raw)
    await useAgentTeamStore.getState().loadTeams()
    const team = useAgentTeamStore.getState().teams[0]
    expect(team.orchestration).toEqual({ mode: 'router' })
  })

  it('preserves existing orchestration when present', async () => {
    const raw = [makeTeam({ orchestration: { mode: 'sequential' } })]
    mockInvoke.mockResolvedValue(raw)
    await useAgentTeamStore.getState().loadTeams()
    expect(useAgentTeamStore.getState().teams[0].orchestration).toEqual({ mode: 'sequential' })
  })
})

describe('createTeam', () => {
  it('creates a team with a generated id and timestamps', async () => {
    mockInvoke.mockResolvedValue(undefined)
    const created = await useAgentTeamStore.getState().createTeam({
      name: 'New Team',
      description: 'desc',
      orchestration: { mode: 'router' },
      agent_ids: [],
    })
    expect(created.id).toBeDefined()
    expect(created.name).toBe('New Team')
    expect(created.created_at).toBeGreaterThan(0)
    expect(created.updated_at).toBeGreaterThan(0)
  })

  it('prepends the new team to the list', async () => {
    mockInvoke.mockResolvedValue(undefined)
    useAgentTeamStore.setState({ teams: [makeTeam({ id: 'existing' })] })
    const created = await useAgentTeamStore.getState().createTeam({
      name: 'Newest',
      description: '',
      orchestration: { mode: 'router' },
      agent_ids: [],
    })
    const teams = useAgentTeamStore.getState().teams
    expect(teams[0].id).toBe(created.id)
    expect(teams[1].id).toBe('existing')
  })

  it('calls save_agent_team invoke', async () => {
    mockInvoke.mockResolvedValue(undefined)
    await useAgentTeamStore.getState().createTeam({
      name: 'T',
      description: '',
      orchestration: { mode: 'router' },
      agent_ids: [],
    })
    expect(mockInvoke).toHaveBeenCalledWith('save_agent_team', expect.objectContaining({ team: expect.any(Object) }))
  })
})

describe('updateTeam', () => {
  it('updates the team in the list and bumps updated_at', async () => {
    const team = makeTeam({ id: 't1', name: 'Old Name' })
    useAgentTeamStore.setState({ teams: [team] })
    mockInvoke.mockResolvedValue(undefined)
    await useAgentTeamStore.getState().updateTeam({ ...team, name: 'New Name' })
    const updated = useAgentTeamStore.getState().teams[0]
    expect(updated.name).toBe('New Name')
    expect(updated.updated_at).toBeGreaterThanOrEqual(team.updated_at)
  })

  it('calls save_agent_team invoke', async () => {
    const team = makeTeam()
    useAgentTeamStore.setState({ teams: [team] })
    mockInvoke.mockResolvedValue(undefined)
    await useAgentTeamStore.getState().updateTeam(team)
    expect(mockInvoke).toHaveBeenCalledWith('save_agent_team', expect.any(Object))
  })
})

describe('deleteTeam', () => {
  it('removes the team from the list', async () => {
    useAgentTeamStore.setState({ teams: [makeTeam({ id: 'del-me' }), makeTeam({ id: 'keep-me' })] })
    mockInvoke.mockResolvedValue(undefined)
    await useAgentTeamStore.getState().deleteTeam('del-me')
    const teams = useAgentTeamStore.getState().teams
    expect(teams).toHaveLength(1)
    expect(teams[0].id).toBe('keep-me')
  })

  it('calls delete_agent_team invoke with correct id', async () => {
    useAgentTeamStore.setState({ teams: [makeTeam({ id: 'del-1' })] })
    mockInvoke.mockResolvedValue(undefined)
    await useAgentTeamStore.getState().deleteTeam('del-1')
    expect(mockInvoke).toHaveBeenCalledWith('delete_agent_team', { teamId: 'del-1' })
  })
})

describe('getTeam', () => {
  it('returns the team by id', () => {
    const team = makeTeam({ id: 'find-me' })
    useAgentTeamStore.setState({ teams: [team] })
    expect(useAgentTeamStore.getState().getTeam('find-me')).toBe(team)
  })

  it('returns undefined for an unknown id', () => {
    expect(useAgentTeamStore.getState().getTeam('nope')).toBeUndefined()
  })
})

describe('exportTeam', () => {
  it('returns null for an unknown team id', () => {
    expect(useAgentTeamStore.getState().exportTeam('nope', () => [])).toBeNull()
  })

  it('exports team with matching agents', () => {
    const team = makeTeam({ id: 't1', agent_ids: ['a1', 'a2'] })
    useAgentTeamStore.setState({ teams: [team] })
    const assistants = [makeAssistant('a1', 'Agent One'), makeAssistant('a2', 'Agent Two')]
    const result = useAgentTeamStore.getState().exportTeam('t1', () => assistants)
    expect(result).not.toBeNull()
    expect(result!.agents).toHaveLength(2)
    expect(result!.agents[0].name).toBe('Agent One')
    expect(result!.team.agent_ids).toEqual([])
  })

  it('excludes agents not found in the assistants list', () => {
    const team = makeTeam({ id: 't1', agent_ids: ['a1', 'missing'] })
    useAgentTeamStore.setState({ teams: [team] })
    const result = useAgentTeamStore.getState().exportTeam('t1', () => [makeAssistant('a1', 'Only One')])
    expect(result!.agents).toHaveLength(1)
  })
})

describe('importTeam', () => {
  it('throws on missing team or agents', async () => {
    await expect(
      useAgentTeamStore.getState().importTeam({ team: null as any, agents: null as any }, vi.fn())
    ).rejects.toThrow('Invalid team import data: missing team or agents')
  })

  it('throws when required team fields are missing', async () => {
    await expect(
      useAgentTeamStore.getState().importTeam(
        { team: { name: '', orchestration: null as any, agent_ids: [], description: '' }, agents: [] },
        vi.fn()
      )
    ).rejects.toThrow('missing required team fields')
  })

  it('creates agents and a team on valid import', async () => {
    mockInvoke.mockResolvedValue(undefined)
    const addAssistant = vi.fn()
    const imported = await useAgentTeamStore.getState().importTeam(
      {
        team: { name: 'Imported', description: 'desc', orchestration: { mode: 'router' }, agent_ids: [] },
        agents: [{ name: 'Agent Alpha' }],
      },
      addAssistant
    )
    expect(imported.name).toBe('Imported')
    expect(addAssistant).toHaveBeenCalledOnce()
    expect(useAgentTeamStore.getState().teams[0].name).toBe('Imported')
  })
})

describe('duplicateTeam', () => {
  it('returns null for an unknown team id', async () => {
    const result = await useAgentTeamStore.getState().duplicateTeam('ghost', () => [], vi.fn())
    expect(result).toBeNull()
  })

  it('duplicates the team with a copy suffix', async () => {
    mockInvoke.mockResolvedValue(undefined)
    const team = makeTeam({ id: 't1', name: 'My Team', agent_ids: ['a1'] })
    useAgentTeamStore.setState({ teams: [team] })
    const assistants = [makeAssistant('a1', 'Agent')]
    const addAssistant = vi.fn()
    const copy = await useAgentTeamStore.getState().duplicateTeam('t1', () => assistants, addAssistant)
    expect(copy).not.toBeNull()
    expect(copy!.name).toBe('My Team (copy)')
    expect(addAssistant).toHaveBeenCalledOnce()
  })
})
