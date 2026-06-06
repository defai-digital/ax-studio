import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildDelegationTools } from './delegation-tools'
import type { AgentDef, DelegationToolOptions } from './delegation-tools'
import { TokenUsageTracker } from './token-usage-tracker'
import { AgentHealthMonitor } from './agent-health-monitor'
import { MultiAgentRunLog } from './run-log'
import { buildOrchestratorPrompt } from './orchestrator-prompt'
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
          text: `Output from agent ${generateCallCount}`,
          usage: { totalTokens: 150 },
          steps: [],
        }
      }),
    })),
  }
})

const team: AgentTeam = {
  id: 'team-seq',
  name: 'Sequential Team',
  description: 'Test',
  orchestration: { mode: 'sequential' },
  agent_ids: ['a1', 'a2', 'a3'],
  created_at: 0,
  updated_at: 0,
}

const agents: AgentDef[] = [
  { id: 'a1', name: 'Researcher', role: 'Research', max_steps: 3 },
  { id: 'a2', name: 'Writer', role: 'Writing', max_steps: 3 },
  { id: 'a3', name: 'Editor', role: 'Editing', max_steps: 3 },
]

function makeOptions(
  overrides: Partial<DelegationToolOptions> = {}
): DelegationToolOptions {
  return {
    model: {} as DelegationToolOptions['model'],
    allTools: {},
    tokenTracker: new TokenUsageTracker(100000),
    healthMonitor: new AgentHealthMonitor(),
    runLog: new MultiAgentRunLog('team-seq', 'thread-1', 100000),
    emitDataPart: vi.fn(),
    createModel: vi.fn().mockResolvedValue({}),
    ...overrides,
  }
}

describe('E2E: Sequential mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    generateCallCount = 0
  })

  it('builds sequential prompt with numbered agent list', () => {
    const prompt = buildOrchestratorPrompt(team, agents)

    expect(prompt).toContain('Execute tasks in this exact order')
    expect(prompt).toContain('1. delegate_to_researcher')
    expect(prompt).toContain('2. delegate_to_writer')
    expect(prompt).toContain('3. delegate_to_editor')
    expect(prompt).toContain("Pass each agent's output as context")
  })

  it('agents can chain context via the context parameter', async () => {
    const emitDataPart = vi.fn()
    const options = makeOptions({ emitDataPart })
    const tools = buildDelegationTools(agents, options)

    // Simulate sequential execution with context chaining
    const result1 = await tools['delegate_to_researcher'].execute!(
      { task: 'Research AI' },
      { toolCallId: 'tc-1', messages: [] }
    )

    const result2 = await tools['delegate_to_writer'].execute!(
      { task: 'Write article', context: (result1 as any).text },
      { toolCallId: 'tc-2', messages: [] }
    )

    const result3 = await tools['delegate_to_editor'].execute!(
      { task: 'Edit article', context: (result2 as any).text },
      { toolCallId: 'tc-3', messages: [] }
    )

    expect((result1 as any).text).toBe('Output from agent 1')
    expect((result2 as any).text).toBe('Output from agent 2')
    expect((result3 as any).text).toBe('Output from agent 3')

    // All 3 agents emitted running + complete status
    const runningCalls = emitDataPart.mock.calls.filter(
      ([, data]: [string, any]) => data.status === 'running'
    )
    const completeCalls = emitDataPart.mock.calls.filter(
      ([, data]: [string, any]) => data.status === 'complete'
    )
    expect(runningCalls).toHaveLength(3)
    expect(completeCalls).toHaveLength(3)
  })

  it('continues with remaining agents when one fails', async () => {
    let callIndex = 0
    const { Experimental_Agent } = await import('ai')
    vi.mocked(Experimental_Agent).mockImplementation(
      () =>
        ({
          generate: vi.fn().mockImplementation(async () => {
            callIndex++
            if (callIndex === 2) {
              throw new Error('Agent 2 rate limited')
            }
            return {
              text: `Result ${callIndex}`,
              usage: { totalTokens: 150 },
              steps: [],
            }
          }),
        }) as any
    )

    const emitDataPart = vi.fn()
    const options = makeOptions({ emitDataPart })
    const tools = buildDelegationTools(agents, options)

    const result1 = await tools['delegate_to_researcher'].execute!(
      { task: 'task1' },
      { toolCallId: 'tc-1', messages: [] }
    )
    expect((result1 as any).text).toBe('Result 1')

    // Agent 2 fails — returns error object (not throw)
    const result2 = await tools['delegate_to_writer'].execute!(
      { task: 'task2' },
      { toolCallId: 'tc-2', messages: [] }
    )
    expect(result2).toHaveProperty('error')

    // Agent 3 still runs
    const result3 = await tools['delegate_to_editor'].execute!(
      { task: 'task3' },
      { toolCallId: 'tc-3', messages: [] }
    )
    expect((result3 as any).text).toBe('Result 3')
  })

  it('run log tracks all steps including errors', async () => {
    let callIdx = 0
    const { Experimental_Agent } = await import('ai')
    vi.mocked(Experimental_Agent).mockImplementation(
      () =>
        ({
          generate: vi.fn().mockImplementation(async () => {
            callIdx++
            if (callIdx === 2) throw new Error('fail')
            return {
              text: 'ok',
              usage: { totalTokens: 75 },
              steps: [],
            }
          }),
        }) as any
    )

    const runLog = new MultiAgentRunLog('team-seq', 'thread-1', 100000)
    const options = makeOptions({ runLog })
    const tools = buildDelegationTools(agents, options)

    await tools['delegate_to_researcher'].execute!(
      { task: 't' },
      { toolCallId: 'tc-1', messages: [] }
    )
    await tools['delegate_to_writer'].execute!(
      { task: 't' },
      { toolCallId: 'tc-2', messages: [] }
    )
    await tools['delegate_to_editor'].execute!(
      { task: 't' },
      { toolCallId: 'tc-3', messages: [] }
    )

    const data = runLog.getData()
    expect(data.steps).toHaveLength(3)
    expect(data.steps[0].status).toBe('complete')
    expect(data.steps[1].status).toBe('error')
    expect(data.steps[2].status).toBe('complete')
    expect(data.total_tokens).toBe(150) // 75 + 0 + 75
  })
})
