import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildDelegationTools } from '../delegation-tools'
import { buildParallelOrchestration } from '../parallel-orchestration'
import type { AgentDef, DelegationToolOptions } from '../delegation-tools'
import type { ParallelOrchestrationOptions } from '../parallel-orchestration'
import { TokenUsageTracker } from '../token-usage-tracker'
import { AgentHealthMonitor } from '../agent-health-monitor'
import { MultiAgentRunLog } from '../run-log'
import type { AgentTeam } from '@/types/agent-team'

vi.mock('ai', async () => {
  const actual = await vi.importActual('ai')
  return {
    ...actual,
    Experimental_Agent: vi.fn().mockImplementation(() => ({
      generate: vi.fn().mockResolvedValue({
        text: 'default response',
        usage: { totalTokens: 75 },
        steps: [],
      }),
    })),
  }
})

const agents: AgentDef[] = [
  { id: 'a1', name: 'Agent1', role: 'Worker', max_steps: 3 },
  { id: 'a2', name: 'Agent2', role: 'Helper', max_steps: 3 },
]

function makeDelegationOptions(
  overrides: Partial<DelegationToolOptions> = {}
): DelegationToolOptions {
  return {
    model: {} as DelegationToolOptions['model'],
    allTools: {},
    tokenTracker: new TokenUsageTracker(100000),
    healthMonitor: new AgentHealthMonitor(),
    runLog: new MultiAgentRunLog('t', 'th', 100000),
    emitDataPart: vi.fn(),
    createModel: vi.fn().mockResolvedValue({}),
    ...overrides,
  }
}

function makeParallelOptions(
  overrides: Partial<ParallelOrchestrationOptions> = {}
): ParallelOrchestrationOptions {
  return {
    model: {} as ParallelOrchestrationOptions['model'],
    allTools: {},
    tokenTracker: new TokenUsageTracker(100000),
    healthMonitor: new AgentHealthMonitor(),
    runLog: new MultiAgentRunLog('t', 'th', 100000),
    emitDataPart: vi.fn(),
    createModel: vi.fn().mockResolvedValue({}),
    ...overrides,
  }
}

describe('E2E: Error scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Abort mid-run', () => {
    it('abort error is re-thrown from delegation tool', async () => {
      const { Experimental_Agent } = await import('ai')
      vi.mocked(Experimental_Agent).mockImplementation(
        () =>
          ({
            generate: vi.fn().mockImplementation(async () => {
              throw new DOMException(
                'The operation was aborted',
                'AbortError'
              )
            }),
          }) as any
      )

      const options = makeDelegationOptions()
      const tools = buildDelegationTools(agents.slice(0, 1), options)

      // AbortErrors are intentionally re-thrown (not caught) by handleSubAgentError
      await expect(
        tools['delegate_to_agent1'].execute!(
          { task: 'test' },
          { toolCallId: 'tc-1', messages: [] }
        )
      ).rejects.toThrow('The operation was aborted')
    })
  })

  describe('Budget exhaustion mid-run', () => {
    it('returns error when budget is exhausted before agent starts', async () => {
      const tokenTracker = new TokenUsageTracker(100)
      tokenTracker.add(100) // exhaust budget

      const options = makeDelegationOptions({ tokenTracker })
      const tools = buildDelegationTools(agents, options)
      const result = await tools['delegate_to_agent1'].execute!(
        { task: 'test' },
        { toolCallId: 'tc-1', messages: [] }
      )

      expect(result).toEqual({
        error: 'Token budget exhausted. Cannot run this agent.',
      })
    })

    it('parallel mode checks budget before each agent', async () => {
      const tokenTracker = new TokenUsageTracker(10) // very small budget
      tokenTracker.add(10) // exhaust

      const team: AgentTeam = {
        id: 't',
        name: 'T',
        description: '',
        orchestration: { mode: 'parallel' },
        agent_ids: ['a1', 'a2'],
        created_at: 0,
        updated_at: 0,
      }

      const options = makeParallelOptions({ tokenTracker })
      const { tools } = buildParallelOrchestration(team, agents, options)
      const result = await tools['run_all_agents_parallel'].execute!(
        { task: 'test' },
        { toolCallId: 'tc-1', messages: [] }
      )

      // Both agents should fail with budget error
      expect(result).toContain('Token budget exhausted')
    })
  })

  describe('All agents fail', () => {
    it('delegation tools return errors for all agents', async () => {
      const { Experimental_Agent } = await import('ai')
      vi.mocked(Experimental_Agent).mockImplementation(
        () =>
          ({
            generate: vi.fn().mockImplementation(async () => {
              throw new Error('LLM service unavailable')
            }),
          }) as any
      )

      const emitDataPart = vi.fn()
      const options = makeDelegationOptions({ emitDataPart })
      const tools = buildDelegationTools(agents, options)

      const r1 = await tools['delegate_to_agent1'].execute!(
        { task: 'task1' },
        { toolCallId: 'tc-1', messages: [] }
      )
      const r2 = await tools['delegate_to_agent2'].execute!(
        { task: 'task2' },
        { toolCallId: 'tc-2', messages: [] }
      )

      expect(r1).toHaveProperty('error')
      expect(r2).toHaveProperty('error')

      // Error status emitted for both
      const errorEmissions = emitDataPart.mock.calls.filter(
        ([, data]: [string, any]) => data.status === 'error'
      )
      expect(errorEmissions).toHaveLength(2)
    })

    it('parallel mode handles all agents failing', async () => {
      const { Experimental_Agent } = await import('ai')
      vi.mocked(Experimental_Agent).mockImplementation(
        () =>
          ({
            generate: vi.fn().mockImplementation(async () => {
              throw new Error('All models down')
            }),
          }) as any
      )

      const team: AgentTeam = {
        id: 't',
        name: 'T',
        description: '',
        orchestration: { mode: 'parallel' },
        agent_ids: ['a1', 'a2'],
        created_at: 0,
        updated_at: 0,
      }

      const options = makeParallelOptions()
      const { tools } = buildParallelOrchestration(team, agents, options)
      const result = await tools['run_all_agents_parallel'].execute!(
        { task: 'test' },
        { toolCallId: 'tc-1', messages: [] }
      )

      expect(result).toContain('status="error"')
      expect(result).toContain('All models down')
    })
  })

  describe('Circuit breaker integration', () => {
    it('circuit opens after repeated failures and blocks subsequent calls', async () => {
      const { Experimental_Agent } = await import('ai')
      vi.mocked(Experimental_Agent).mockImplementation(
        () =>
          ({
            generate: vi.fn().mockImplementation(async () => {
              throw new Error('Server error')
            }),
          }) as any
      )

      const healthMonitor = new AgentHealthMonitor()
      const options = makeDelegationOptions({ healthMonitor })

      const singleAgent: AgentDef[] = [
        { id: 'a1', name: 'Agent1', role: 'Worker', max_steps: 3 },
      ]
      const tools = buildDelegationTools(singleAgent, options)

      // First call fails
      await tools['delegate_to_agent1'].execute!(
        { task: 'task' },
        { toolCallId: 'tc-1', messages: [] }
      )
      // Second call fails — circuit should open
      await tools['delegate_to_agent1'].execute!(
        { task: 'task' },
        { toolCallId: 'tc-2', messages: [] }
      )

      // Third call should be blocked by circuit breaker
      const result = await tools['delegate_to_agent1'].execute!(
        { task: 'task' },
        { toolCallId: 'tc-3', messages: [] }
      )
      expect(result).toEqual({
        error: expect.stringContaining('circuit open'),
      })
    })
  })

  describe('Run log completeness', () => {
    it('run log captures all state correctly', async () => {
      // Ensure mock returns known token count
      const { Experimental_Agent } = await import('ai')
      vi.mocked(Experimental_Agent).mockImplementation(
        () =>
          ({
            generate: vi.fn().mockResolvedValue({
              text: 'done',
              usage: { totalTokens: 75 },
              steps: [],
            }),
          }) as any
      )

      const runLog = new MultiAgentRunLog('team-1', 'thread-1', 50000)
      const options = makeDelegationOptions({ runLog })
      const tools = buildDelegationTools(agents, options)

      await tools['delegate_to_agent1'].execute!(
        { task: 't' },
        { toolCallId: 'tc-1', messages: [] }
      )
      await tools['delegate_to_agent2'].execute!(
        { task: 't' },
        { toolCallId: 'tc-2', messages: [] }
      )

      runLog.setOrchestratorTokens(500)
      runLog.complete()

      const data = runLog.getData()
      expect(data.status).toBe('completed')
      expect(data.total_tokens).toBe(650) // 75 + 75 + 500
      expect(data.orchestrator_tokens).toBe(500)
      expect(data.steps).toHaveLength(2)
      expect(data.completed_at).toBeDefined()
      expect(data.team_id).toBe('team-1')
      expect(data.thread_id).toBe('thread-1')
    })
  })
})
