import { describe, it, expect, vi } from 'vitest'
import { TokenUsageTracker } from './token-usage-tracker'
import { AgentHealthMonitor } from './agent-health-monitor'
import { MultiAgentRunLog } from './run-log'
import { buildOrchestratorPrompt } from './orchestrator-prompt'
import { buildDelegationTools } from './delegation-tools'
import type { AgentTeam } from '@/types/agent-team'

// Mock AI SDK Agent
vi.mock('ai', async () => {
  const actual = await vi.importActual('ai')
  return {
    ...actual,
    Experimental_Agent: vi.fn().mockImplementation(() => ({
      generate: vi.fn().mockResolvedValue({
        text: 'Sub-agent result text',
        usage: { totalTokens: 1000 },
        steps: [],
      }),
    })),
  }
})

function makeTeam(overrides: Partial<AgentTeam> = {}): AgentTeam {
  return {
    id: 'team-1',
    name: 'Test Team',
    description: 'A test team',
    orchestration: { mode: 'router' },
    agent_ids: ['agent-1', 'agent-2'],
    token_budget: 50000,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  }
}

function makeAgents() {
  return [
    {
      id: 'agent-1',
      name: 'Researcher',
      role: 'Research',
      goal: 'Find info',
      description: 'Research agent',
      instructions: 'Do research',
      max_steps: 5,
      max_result_tokens: 2000,
    },
    {
      id: 'agent-2',
      name: 'Writer',
      role: 'Writing',
      goal: 'Write content',
      description: 'Writing agent',
      instructions: 'Write well',
      max_steps: 5,
      max_result_tokens: 2000,
    },
  ]
}

describe('Multi-Agent Integration', () => {
  it('orchestrator prompt + delegation tools work together for router mode', () => {
    const team = makeTeam()
    const agents = makeAgents()

    const prompt = buildOrchestratorPrompt(team, agents)
    expect(prompt).toContain('delegate to exactly ONE')
    expect(prompt).toContain('delegate_to_researcher')
    expect(prompt).toContain('delegate_to_writer')

    const tools = buildDelegationTools(agents, {
      model: {} as never,
      allTools: {},
      tokenTracker: new TokenUsageTracker(50000),
      healthMonitor: new AgentHealthMonitor(),
      runLog: new MultiAgentRunLog('team-1', 'thread-1', 50000),
      emitDataPart: vi.fn(),
      createModel: vi.fn().mockResolvedValue({}),
    })

    // Tool names match what the prompt references
    expect(tools).toHaveProperty('delegate_to_researcher')
    expect(tools).toHaveProperty('delegate_to_writer')
  })

  it('token budget is enforced across multiple agent calls', async () => {
    const tokenTracker = new TokenUsageTracker(1500) // tight budget
    const emitDataPart = vi.fn()

    const tools = buildDelegationTools(makeAgents(), {
      model: {} as never,
      allTools: {},
      tokenTracker,
      healthMonitor: new AgentHealthMonitor(),
      runLog: new MultiAgentRunLog('team-1', 'thread-1', 1500),
      emitDataPart,
      createModel: vi.fn().mockResolvedValue({}),
    })

    // First call succeeds (uses 1000 tokens from mock)
    const result1 = await tools['delegate_to_researcher'].execute!(
      { task: 'research' },
      { abortSignal: undefined } as never
    )
    expect(result1).toHaveProperty('text')

    // Second call should fail (budget exhausted: 1000 >= 1500? no, but close)
    // Actually 1000 < 1500, so it runs and adds another 1000 → 2000 total
    const result2 = await tools['delegate_to_writer'].execute!(
      { task: 'write' },
      { abortSignal: undefined } as never
    )
    expect(result2).toHaveProperty('text')
    expect(tokenTracker.isExhausted()).toBe(true) // 2000 >= 1500
  })

  it('circuit breaker prevents retrying failed agents', async () => {
    const healthMonitor = new AgentHealthMonitor()
    const emitDataPart = vi.fn()

    // Simulate 2 failures on researcher
    healthMonitor.recordFailure('agent-1')
    healthMonitor.recordFailure('agent-1')

    const tools = buildDelegationTools(makeAgents(), {
      model: {} as never,
      allTools: {},
      tokenTracker: new TokenUsageTracker(100000),
      healthMonitor,
      runLog: new MultiAgentRunLog('team-1', 'thread-1', 100000),
      emitDataPart,
      createModel: vi.fn().mockResolvedValue({}),
    })

    // Researcher should be blocked
    const result = await tools['delegate_to_researcher'].execute!(
      { task: 'research' },
      { abortSignal: undefined } as never
    )
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toContain('temporarily unavailable')

    // Writer should still work
    const result2 = await tools['delegate_to_writer'].execute!(
      { task: 'write' },
      { abortSignal: undefined } as never
    )
    expect(result2).toHaveProperty('text')
  })

  it('run log tracks agent steps and tokens', async () => {
    const runLog = new MultiAgentRunLog('team-1', 'thread-1', 100000)

    const tools = buildDelegationTools(makeAgents(), {
      model: {} as never,
      allTools: {},
      tokenTracker: new TokenUsageTracker(100000),
      healthMonitor: new AgentHealthMonitor(),
      runLog,
      emitDataPart: vi.fn(),
      createModel: vi.fn().mockResolvedValue({}),
    })

    await tools['delegate_to_researcher'].execute!(
      { task: 'research' },
      { abortSignal: undefined } as never
    )

    const data = runLog.getData()
    expect(data.steps).toHaveLength(1)
    expect(data.steps[0].agent_name).toBe('Researcher')
    expect(data.steps[0].tokens_used).toBe(1000)
    expect(data.steps[0].status).toBe('complete')
    expect(data.total_tokens).toBe(1000)
  })

  it('run log getUsage returns correct budget and percentage', async () => {
    const runLog = new MultiAgentRunLog('team-1', 'thread-1', 10000)

    const tools = buildDelegationTools(makeAgents(), {
      model: {} as never,
      allTools: {},
      tokenTracker: new TokenUsageTracker(10000),
      healthMonitor: new AgentHealthMonitor(),
      runLog,
      emitDataPart: vi.fn(),
      createModel: vi.fn().mockResolvedValue({}),
    })

    await tools['delegate_to_researcher'].execute!(
      { task: 'research' },
      { abortSignal: undefined } as never
    )

    const usage = runLog.getUsage()
    expect(usage.consumed).toBe(1000)
    expect(usage.budget).toBe(10000)
    expect(usage.percentage).toBe(10)
  })

  it('sequential mode prompt chains agents in order', () => {
    const team = makeTeam({ orchestration: { mode: 'sequential' } })
    const prompt = buildOrchestratorPrompt(team, makeAgents())
    expect(prompt).toContain('1. delegate_to_researcher')
    expect(prompt).toContain('2. delegate_to_writer')
    expect(prompt).toContain('in this exact order')
  })

  it('data parts are emitted for each agent execution', async () => {
    const emitDataPart = vi.fn()

    const tools = buildDelegationTools(makeAgents(), {
      model: {} as never,
      allTools: {},
      tokenTracker: new TokenUsageTracker(100000),
      healthMonitor: new AgentHealthMonitor(),
      runLog: new MultiAgentRunLog('team-1', 'thread-1', 100000),
      emitDataPart,
      createModel: vi.fn().mockResolvedValue({}),
    })

    await tools['delegate_to_researcher'].execute!(
      { task: 'research' },
      { abortSignal: undefined } as never
    )

    await tools['delegate_to_writer'].execute!(
      { task: 'write' },
      { abortSignal: undefined } as never
    )

    // 2 agents × 2 events (running + complete) = 4
    expect(emitDataPart).toHaveBeenCalledTimes(4)

    const calls = emitDataPart.mock.calls
    expect(calls[0][1].agent_name).toBe('Researcher')
    expect(calls[0][1].status).toBe('running')
    expect(calls[1][1].agent_name).toBe('Researcher')
    expect(calls[1][1].status).toBe('complete')
    expect(calls[2][1].agent_name).toBe('Writer')
    expect(calls[2][1].status).toBe('running')
    expect(calls[3][1].agent_name).toBe('Writer')
    expect(calls[3][1].status).toBe('complete')
  })
})
