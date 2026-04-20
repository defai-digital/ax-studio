import { create } from 'zustand'
import type { AgentTeam } from '@/types/agent-team'

async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

export interface TeamExportData {
  team: Omit<AgentTeam, 'id' | 'created_at' | 'updated_at'>
  agents: Array<{
    name: string
    role?: string
    goal?: string
    description?: string
    instructions?: string
    parameters?: Record<string, unknown>
    model_override_id?: string
    tool_scope?: { mode: 'all' | 'include' | 'exclude'; tool_keys: string[] }
    max_steps?: number
    timeout?: { total_ms?: number; step_ms?: number }
    max_result_tokens?: number
    optional?: boolean
  }>
}

interface AgentTeamState {
  teams: AgentTeam[]
  isLoaded: boolean
  loadError: string | null
  loadTeams: () => Promise<void>
  createTeam: (
    team: Omit<AgentTeam, 'id' | 'created_at' | 'updated_at'>
  ) => Promise<AgentTeam>
  updateTeam: (team: AgentTeam) => Promise<void>
  deleteTeam: (teamId: string) => Promise<void>
  getTeam: (teamId: string) => AgentTeam | undefined
  duplicateTeam: (
    teamId: string,
    getAssistants: () => Assistant[],
    addAssistant: (agent: Assistant) => void,
    removeAssistant?: (agentId: string) => void
  ) => Promise<AgentTeam | null>
  exportTeam: (
    teamId: string,
    getAssistants: () => Assistant[]
  ) => TeamExportData | null
  importTeam: (
    data: TeamExportData,
    addAssistant: (agent: Assistant) => void,
    removeAssistant?: (agentId: string) => void
  ) => Promise<AgentTeam>
}

// Module-level dedupe handle for concurrent `loadTeams()` calls — see
// the `loadTeams` implementation below for why.
let loadTeamsPromise: Promise<void> | null = null

export const useAgentTeamStore = create<AgentTeamState>((set, get) => ({
  teams: [],
  isLoaded: false,
  loadError: null,

  loadTeams: async () => {
    // Deduplicate concurrent loads. Three components independently call
    // `loadTeams()` on mount when `isLoaded` is false — without this guard
    // we fire three parallel `list_agent_teams` Tauri invokes on startup
    // and thrash the teams state with three sequential setters.
    if (loadTeamsPromise) return loadTeamsPromise
    loadTeamsPromise = (async () => {
      try {
        const raw = await invoke<AgentTeam[]>('list_agent_teams')
        // Normalize: ensure every team has orchestration (older saved
        // teams may lack it).
        const teams = raw.map((t) => ({
          ...t,
          orchestration: t.orchestration ?? { mode: 'router' as const },
        }))
        set({ teams, isLoaded: true, loadError: null })
      } catch (error) {
        // Surface the error into store state so the settings UI can show
        // a "failed to load teams" message. Previously this `catch` was
        // absent and the `finally` below reset the dedup handle so any
        // component that retried just hit the same silent failure.
        console.error('Failed to load agent teams:', error)
        set({
          isLoaded: true,
          loadError: error instanceof Error ? error.message : String(error),
        })
      } finally {
        loadTeamsPromise = null
      }
    })()
    return loadTeamsPromise
  },

  createTeam: async (partial) => {
    const now = Date.now()
    const team: AgentTeam = {
      ...partial,
      id: crypto.randomUUID(),
      created_at: now,
      updated_at: now,
    }
    await invoke('save_agent_team', { team })
    set((s) => ({ teams: [team, ...s.teams] }))
    return team
  },

  updateTeam: async (team) => {
    const updated = { ...team, updated_at: Date.now() }
    await invoke('save_agent_team', { team: updated })
    set((s) => ({
      teams: s.teams.map((t) => (t.id === updated.id ? updated : t)),
    }))
  },

  deleteTeam: async (teamId) => {
    await invoke('delete_agent_team', { teamId })
    set((s) => ({ teams: s.teams.filter((t) => t.id !== teamId) }))
  },

  getTeam: (teamId) => get().teams.find((t) => t.id === teamId),

  duplicateTeam: async (teamId, getAssistants, addAssistant, removeAssistant) => {
    const team = get().teams.find((t) => t.id === teamId)
    if (!team) return null

    const assistants = getAssistants()
    const newAgentIds: string[] = []

    for (const agentId of team.agent_ids) {
      const original = assistants.find((a) => a.id === agentId)
      if (!original) continue
      const copy: Assistant = {
        ...original,
        id: crypto.randomUUID(),
        name: `${original.name} (copy)`,
        created_at: Date.now(),
      }
      addAssistant(copy)
      newAgentIds.push(copy.id)
    }

    try {
      return await get().createTeam({
        name: `${team.name} (copy)`,
        description: team.description,
        orchestration: team.orchestration,
        orchestrator_instructions: team.orchestrator_instructions,
        orchestrator_model_id: team.orchestrator_model_id,
        agent_ids: newAgentIds,
        variables: team.variables,
        token_budget: team.token_budget,
        cost_approval_threshold: team.cost_approval_threshold,
        parallel_stagger_ms: team.parallel_stagger_ms,
      })
    } catch (error) {
      // Roll back the assistant copies so we don't leave orphans behind.
      if (removeAssistant) {
        for (const id of newAgentIds) removeAssistant(id)
      }
      throw error
    }
  },

  exportTeam: (teamId, getAssistants) => {
    const team = get().teams.find((t) => t.id === teamId)
    if (!team) return null
    const assistants = getAssistants()
    const missingIds = team.agent_ids.filter(
      (id) => !assistants.some((a) => a.id === id)
    )
    if (missingIds.length > 0) {
      console.warn(
        `exportTeam: ${missingIds.length} agent(s) referenced by team "${team.name}" were not found and will be excluded: ${missingIds.join(', ')}`
      )
    }
    const agents = team.agent_ids
      .map((id) => assistants.find((a) => a.id === id))
      .filter((a): a is Assistant => !!a)
      .map((a) => ({
        name: a.name,
        role: a.role,
        goal: a.goal,
        description: a.description,
        instructions: a.instructions,
        parameters: a.parameters,
        model_override_id: a.model_override_id,
        tool_scope: a.tool_scope,
        max_steps: a.max_steps,
        timeout: a.timeout,
        max_result_tokens: a.max_result_tokens,
        optional: a.optional,
      }))

    return {
      team: {
        name: team.name,
        description: team.description,
        orchestration: team.orchestration,
        orchestrator_instructions: team.orchestrator_instructions,
        orchestrator_model_id: team.orchestrator_model_id,
        agent_ids: [],
        variables: team.variables,
        token_budget: team.token_budget,
        cost_approval_threshold: team.cost_approval_threshold,
        parallel_stagger_ms: team.parallel_stagger_ms,
      },
      agents,
    }
  },

  importTeam: async (data, addAssistant, removeAssistant) => {
    if (!data?.team || !Array.isArray(data?.agents)) {
      throw new Error('Invalid team import data: missing team or agents')
    }
    if (!data.team.name || !data.team.orchestration) {
      throw new Error('Invalid team import data: missing required team fields (name, orchestration)')
    }

    const agentIds: string[] = []
    for (const agentDef of data.agents) {
      const agent: Assistant = {
        id: crypto.randomUUID(),
        name: agentDef.name,
        avatar: '',
        created_at: Date.now(),
        description: agentDef.description,
        instructions: agentDef.instructions ?? '',
        parameters: agentDef.parameters ?? {},
        type: 'agent',
        role: agentDef.role,
        goal: agentDef.goal,
        model_override_id: agentDef.model_override_id,
        tool_scope: agentDef.tool_scope,
        max_steps: agentDef.max_steps,
        timeout: agentDef.timeout,
        max_result_tokens: agentDef.max_result_tokens,
        optional: agentDef.optional,
      }
      addAssistant(agent)
      agentIds.push(agent.id)
    }

    try {
      return await get().createTeam({
        ...data.team,
        agent_ids: agentIds,
      })
    } catch (error) {
      // Roll back the imported assistants so they don't linger as orphans
      // when the backend rejects the team save.
      if (removeAssistant) {
        for (const id of agentIds) removeAssistant(id)
      }
      throw error
    }
  },
}))
