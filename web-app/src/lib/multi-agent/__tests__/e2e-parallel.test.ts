import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildParallelOrchestration } from '../parallel-orchestration'
import type { ParallelOrchestrationOptions } from '../parallel-orchestration'
import type { AgentDef } from '../delegation-tools'
import { TokenUsageTracker } from '../token-usage-tracker'
import { AgentHealthMonitor } from '../agent-health-monitor'
import { MultiAgentRunLog } from '../run-log'
import type { AgentTeam } from '@/types/agent-team'

let generateCallCount = 0

vi.mock('ai', async () => {
  const actual = await vi.importActual('ai')
  return {
    ...actual,
    Experimental_Agent: vi.fn().mockImplementation(() => ({
      generate: vi.fn().mockImplementation(async () => {
        generateCallCount++
        return {
          text: `Review ${generateCallCount}`,
          usage: { totalTokens: 150 },
          steps: [],
        }
      }),
    })),
  }
})

const team: AgentTeam = {
  id: 'team-par',
  name: 'Parallel Team',
  description: 'Test',
  orchestration: { mode: 'parallel' },
  agent_ids: ['a1', 'a2', 'a3'],
  created_at: 0,
  updated_at: 0,
}

const agents: AgentDef[] = [
  { id: 'a1', name: 'Quality', role: 'Quality Reviewer', max_steps: 3 },
  { id: 'a2', name: 'Security', role: 'Security Auditor', max_steps: 3 },
  { id: 'a3', name: 'Performance', role: 'Perf Engineer', max_steps: 3 },
]

function makeOptions(
  overrides: Partial<ParallelOrchestrationOptions> = {}
): ParallelOrchestrationOptions {
  return {
    model: {} as ParallelOrchestrationOptions['model'],
    allTools: {},
    tokenTracker: new TokenUsageTracker(100000),
    healthMonitor: new AgentHealthMonitor(),
    runLog: new MultiAgentRunLog('team-par', 'thread-1', 100000),
    emitDataPart: vi.fn(),
    createModel: vi.fn().mockResolvedValue({}),
    ...overrides,
  }
}

describe('E2E: Parallel mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generateCallCount = 0
  })

  it('runs all agents concurrently and combines results', async () => {
    const emitDataPart = vi.fn()
    const options = makeOptions({ emitDataPart })

    const { tools, system } = buildParallelOrchestration(team, agents, options)

    expect(system).toContain('run_all_agents_parallel')
    expect(tools).toHaveProperty('run_all_agents_parallel')

    const result = await tools['run_all_agents_parallel'].execute!(
      { task: 'Review this code' },
      { toolCallId: 'tc-1', messages: [] }
    )

    expect(typeof result).toBe('string')
    expect(result).toContain('<agent_output name="Quality"')
    expect(result).toContain('<agent_output name="Security"')
    expect(result).toContain('<agent_output name="Performance"')

    // 3 running + 3 complete status emissions
    const statusCalls = emitDataPart.mock.calls.filter(
      ([type]: [string]) => type === 'agentStatus'
    )
    expect(statusCalls).toHaveLength(6)
  })

  it('handles partial failure with Promise.allSettled', async () => {
    let idx = 0
    const { Experimental_Agent } = await import('ai')
    vi.mocked(Experimental_Agent).mockImplementation(
      () =>
        ({
          generate: vi.fn().mockImplementation(async () => {
            idx++
            if (idx === 2) throw new Error('Security agent crashed')
            return {
              text: `Result ${idx}`,
              usage: { totalTokens: 150 },
              steps: [],
            }
          }),
        }) as any
    )

    const emitDataPart = vi.fn()
    const options = makeOptions({ emitDataPart })

    const { tools } = buildParallelOrchestration(team, agents, options)
    const result = await tools['run_all_agents_parallel'].execute!(
      { task: 'Review code' },
      { toolCallId: 'tc-1', messages: [] }
    )

    // Quality and Performance succeed, Security fails
    expect(result).toContain('<agent_output name="Quality"')
    expect(result).toContain(
      '<agent_output name="Security" role="Security Auditor" status="error">'
    )
    expect(result).toContain('<agent_output name="Performance"')
    expect(result).toContain('Security agent crashed')
  })

  it('respects stagger delay', async () => {
    const startTimes: number[] = []
    const { Experimental_Agent } = await import('ai')
    vi.mocked(Experimental_Agent).mockImplementation(
      () =>
        ({
          generate: vi.fn().mockImplementation(async () => {
            startTimes.push(Date.now())
            return {
              text: 'ok',
              usage: { totalTokens: 15 },
              steps: [],
            }
          }),
        }) as any
    )

    const staggerTeam = { ...team, parallel_stagger_ms: 50 }
    const options = makeOptions()

    const { tools } = buildParallelOrchestration(staggerTeam, agents, options)
    await tools['run_all_agents_parallel'].execute!(
      { task: 'test' },
      { toolCallId: 'tc-1', messages: [] }
    )

    // Agent 2 should start ~50ms after agent 1, agent 3 ~100ms after agent 1
    expect(startTimes).toHaveLength(3)
    if (startTimes.length === 3) {
      expect(startTimes[1] - startTimes[0]).toBeGreaterThanOrEqual(30) // some tolerance
      expect(startTimes[2] - startTimes[0]).toBeGreaterThanOrEqual(60)
    }
  })

  it('token tracker accumulates from all agents', async () => {
    // Ensure mock returns known token count (prior tests may override)
    const { Experimental_Agent } = await import('ai')
    vi.mocked(Experimental_Agent).mockImplementation(
      () =>
        ({
          generate: vi.fn().mockResolvedValue({
            text: 'result',
            usage: { totalTokens: 150 },
            steps: [],
          }),
        }) as any
    )

    const tokenTracker = new TokenUsageTracker(100000)
    const options = makeOptions({ tokenTracker })

    const { tools } = buildParallelOrchestration(team, agents, options)
    await tools['run_all_agents_parallel'].execute!(
      { task: 'test' },
      { toolCallId: 'tc-1', messages: [] }
    )

    // 3 agents * 150 tokens each
    expect(tokenTracker.getUsage().consumed).toBe(450)
  })
})
