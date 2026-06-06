export interface RunLogStep {
  agent_id: string
  agent_name: string
  agent_role?: string
  tokens_used: number
  duration_ms: number
  status: 'complete' | 'error'
  error?: string
  tool_calls?: Array<{ name: string; args: unknown }>
}

export interface RunLogData {
  id: string
  team_id: string
  thread_id: string
  status: 'running' | 'completed' | 'failed'
  steps: RunLogStep[]
  total_tokens: number
  orchestrator_tokens: number
  started_at: number
  completed_at?: number
  error?: string
}

export class MultiAgentRunLog {
  private data: RunLogData
  private budget: number
  private agentStartTimes: Map<string, number> = new Map()

  constructor(teamId: string, threadId?: string, budget = 0) {
    this.budget = budget
    this.data = {
      id: crypto.randomUUID(),
      team_id: teamId,
      thread_id: threadId ?? '',
      status: 'running',
      steps: [],
      total_tokens: 0,
      orchestrator_tokens: 0,
      started_at: Date.now(),
    }
  }

  markAgentStart(agentId: string): void {
    this.agentStartTimes.set(agentId, Date.now())
  }

  addAgentStep(
    agent: { id: string; name: string; role?: string },
    result: { usage?: { totalTokens?: number }; steps?: Array<{ toolCalls?: Array<{ toolName: string; input: unknown }> }> },
    tokens: number
  ): void {
    const toolCalls = result.steps
      ?.flatMap((s) => s.toolCalls ?? [])
      .map((tc) => ({ name: tc.toolName, args: tc.input }))

    const startTime = this.agentStartTimes.get(agent.id)
    const durationMs = startTime ? Date.now() - startTime : 0
    this.agentStartTimes.delete(agent.id)

    this.data.steps.push({
      agent_id: agent.id,
      agent_name: agent.name,
      agent_role: agent.role,
      tokens_used: tokens,
      duration_ms: durationMs,
      status: 'complete',
      tool_calls: toolCalls,
    })
    this.data.total_tokens += tokens
  }

  addAgentError(
    agent: { id: string; name: string; role?: string },
    error: string
  ): void {
    const startTime = this.agentStartTimes.get(agent.id)
    const durationMs = startTime ? Date.now() - startTime : 0
    this.agentStartTimes.delete(agent.id)

    this.data.steps.push({
      agent_id: agent.id,
      agent_name: agent.name,
      agent_role: agent.role,
      tokens_used: 0,
      duration_ms: durationMs,
      status: 'error',
      error,
    })
  }

  setOrchestratorTokens(tokens: number): void {
    // Subtract any previously set orchestrator tokens before adding new value
    this.data.total_tokens =
      this.data.total_tokens - this.data.orchestrator_tokens + tokens
    this.data.orchestrator_tokens = tokens
  }

  complete(): void {
    this.data.status = 'completed'
    this.data.completed_at = Date.now()
  }

  fail(error: string): void {
    this.data.status = 'failed'
    this.data.error = error
    this.data.completed_at = Date.now()
  }

  getUsage(): { consumed: number; budget: number; percentage: number } {
    return {
      consumed: this.data.total_tokens,
      budget: this.budget,
      percentage: this.budget > 0
        ? Math.round((this.data.total_tokens / this.budget) * 100)
        : 0,
    }
  }

  getData(): RunLogData {
    return { ...this.data, steps: this.data.steps.map((s) => ({ ...s })) }
  }
}

export async function persistRunLog(
  log: MultiAgentRunLog
): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const data = log.getData()
    await invoke('save_agent_run_log', {
      threadId: data.thread_id,
      log: data,
    })
  } catch (error) {
    console.warn('Failed to persist run log:', error)
  }
}
