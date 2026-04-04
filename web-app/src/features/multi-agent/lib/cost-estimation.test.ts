import { describe, it, expect } from 'vitest'
import { estimateTeamRunCost } from './cost-estimation'
import type { AgentTeam } from '@/types/agent-team'

const makeTeam = (overrides: Partial<AgentTeam> = {}): AgentTeam => ({
  id: 'team-1',
  name: 'Test',
  description: 'Test',
  orchestration: { mode: 'router' },
  agent_ids: [],
  created_at: Date.now(),
  updated_at: Date.now(),
  ...overrides,
})

describe('estimateTeamRunCost', () => {
  it('estimates cost for a single agent with defaults', () => {
    const team = makeTeam({ token_budget: 100000 })
    const agents = [{ name: 'Agent A' }]

    const estimate = estimateTeamRunCost(team, agents)

    // Default: 1500 * 10 + 500 = 15500 per agent (no tool_scope = 'all' = 500 overhead)
    expect(estimate.agents).toHaveLength(1)
    expect(estimate.agents[0].estimatedTokens).toBe(15500)
    expect(estimate.orchestratorOverhead).toBe(3000)
    expect(estimate.range.max).toBe(15500 + 3000)
    expect(estimate.range.min).toBe(Math.round(15500 * 0.3 + 3000))
    expect(estimate.budget).toBe(100000)
    expect(estimate.withinBudget).toBe(true)
  })

  it('scales with agent count', () => {
    const team = makeTeam({ token_budget: 100000 })
    const agentsSingle = [{ name: 'A' }]
    const agentsTriple = [{ name: 'A' }, { name: 'B' }, { name: 'C' }]

    const estimateSingle = estimateTeamRunCost(team, agentsSingle)
    const estimateTriple = estimateTeamRunCost(team, agentsTriple)

    // More agents = higher estimate
    expect(estimateTriple.range.max).toBeGreaterThan(estimateSingle.range.max)
    expect(estimateTriple.agents).toHaveLength(3)
  })

  it('scales with max_steps', () => {
    const team = makeTeam()
    const lowSteps = [{ name: 'A', max_steps: 3 }]
    const highSteps = [{ name: 'A', max_steps: 20 }]

    const estimateLow = estimateTeamRunCost(team, lowSteps)
    const estimateHigh = estimateTeamRunCost(team, highSteps)

    expect(estimateHigh.agents[0].estimatedTokens).toBeGreaterThan(
      estimateLow.agents[0].estimatedTokens
    )
  })

  it('uses lower tool overhead for scoped tools', () => {
    const team = makeTeam()
    const allTools = [{ name: 'A', tool_scope: { mode: 'all' } }]
    const scopedTools = [{ name: 'A', tool_scope: { mode: 'include' } }]

    const estimateAll = estimateTeamRunCost(team, allTools)
    const estimateScoped = estimateTeamRunCost(team, scopedTools)

    // All tools: overhead 500, scoped: overhead 200
    expect(estimateAll.agents[0].estimatedTokens).toBeGreaterThan(
      estimateScoped.agents[0].estimatedTokens
    )
  })

  it('reports withinBudget as false when max exceeds budget', () => {
    const team = makeTeam({ token_budget: 5000 })
    const agents = [{ name: 'A', max_steps: 10 }]

    const estimate = estimateTeamRunCost(team, agents)

    expect(estimate.withinBudget).toBe(false)
  })

  it('uses default budget of 100000 when not specified', () => {
    const team = makeTeam({ token_budget: undefined })
    const agents = [{ name: 'A' }]

    const estimate = estimateTeamRunCost(team, agents)

    expect(estimate.budget).toBe(100000)
  })

  it('min estimate is approximately 30% of max (minus overhead)', () => {
    const team = makeTeam()
    const agents = [{ name: 'A' }, { name: 'B' }]

    const estimate = estimateTeamRunCost(team, agents)

    const agentMaxSum = estimate.agents.reduce(
      (s, a) => s + a.estimatedTokens,
      0
    )
    const expectedMin = Math.round(agentMaxSum * 0.3 + 3000)
    expect(estimate.range.min).toBe(expectedMin)
  })

  it('caps estimate at max_result_tokens when lower than step-based estimate', () => {
    const team = makeTeam({ token_budget: 100000 })
    const agents = [
      { name: 'Agent A', max_steps: 10, max_result_tokens: 4000 },
    ]

    const estimate = estimateTeamRunCost(team, agents)

    // Step-based: 1500 * 10 + 500 = 15500, but capped at 4000
    expect(estimate.agents[0].estimatedTokens).toBe(4000)
    expect(estimate.range.max).toBe(4000 + 3000)
    expect(estimate.withinBudget).toBe(true)
  })

  it('uses step-based estimate when max_result_tokens is higher', () => {
    const team = makeTeam()
    const agents = [
      { name: 'Agent A', max_steps: 5, max_result_tokens: 50000 },
    ]

    const estimate = estimateTeamRunCost(team, agents)

    // Step-based: 1500 * 5 + 500 = 8000, which is less than 50000
    expect(estimate.agents[0].estimatedTokens).toBe(8000)
  })

  it('uses step-based estimate when max_result_tokens is not set', () => {
    const team = makeTeam()
    const agents = [{ name: 'Agent A', max_steps: 10 }]

    const estimate = estimateTeamRunCost(team, agents)

    expect(estimate.agents[0].estimatedTokens).toBe(15500)
  })

  it('caps multiple agents independently with max_result_tokens', () => {
    const team = makeTeam({ token_budget: 100000 })
    const agents = [
      { name: 'Agent A', max_steps: 10, max_result_tokens: 4000 },
      { name: 'Agent B', max_steps: 10, max_result_tokens: 4000 },
    ]

    const estimate = estimateTeamRunCost(team, agents)

    expect(estimate.agents[0].estimatedTokens).toBe(4000)
    expect(estimate.agents[1].estimatedTokens).toBe(4000)
    // Total max: 4000 + 4000 + 3000 orchestrator = 11000
    expect(estimate.range.max).toBe(11000)
    // Total min: (4000 * 0.3 + 4000 * 0.3) + 3000 = 5400
    expect(estimate.range.min).toBe(5400)
  })
})
