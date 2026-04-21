import type { AgentTeam } from '@/types/agent-team'

export interface CostEstimate {
  agents: Array<{ agent: string; estimatedTokens: number }>
  orchestratorOverhead: number
  range: { min: number; max: number }
  budget: number
  withinBudget: boolean
}

export function estimateTeamRunCost(
  team: AgentTeam,
  agents: Array<{
    name: string
    max_steps?: number
    max_result_tokens?: number
    tool_scope?: { mode: string }
  }>
): CostEstimate {
  const agentEstimates = agents.map((agent) => {
    const avgTokensPerStep = 1500
    const steps = agent.max_steps ?? 10
    const toolOverhead =
      !agent.tool_scope || agent.tool_scope.mode === 'all' ? 500 : 200

    const stepBasedEstimate = avgTokensPerStep * steps + toolOverhead
    const estimatedTokens =
      agent.max_result_tokens != null
        ? Math.min(stepBasedEstimate, agent.max_result_tokens)
        : stepBasedEstimate

    return {
      agent: agent.name,
      estimatedTokens,
    }
  })

  const orchestratorOverhead = 3000

  const totalAgentTokens = agentEstimates.reduce(
    (s, a) => s + a.estimatedTokens,
    0
  )

  const orchestratorOverheadWithContext = orchestratorOverhead + Math.round(totalAgentTokens * 0.15)

  // Evaluator-optimizer runs agents multiple times (up to max_iterations)
  const iterationMultiplier =
    team.orchestration.mode === 'evaluator-optimizer'
      ? ('max_iterations' in team.orchestration
          ? (team.orchestration.max_iterations ?? 3)
          : 3)
      : 1

  // Min estimate: assume agents use ~30% of max steps (typical for well-scoped tasks)
  const totalMin = agentEstimates.reduce(
    (s, a) => s + a.estimatedTokens * 0.3 * iterationMultiplier,
    orchestratorOverheadWithContext
  )
  const totalMax = agentEstimates.reduce(
    (s, a) => s + a.estimatedTokens * iterationMultiplier,
    orchestratorOverheadWithContext
  )

  const budget = team.token_budget ?? 100000

  return {
    agents: agentEstimates,
    orchestratorOverhead,
    range: { min: Math.round(totalMin), max: Math.round(totalMax) },
    budget,
    withinBudget: totalMax <= budget,
  }
}
