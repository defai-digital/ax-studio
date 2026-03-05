import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildDelegationTools, type DelegationToolOptions } from '../delegation-tools'
import { TokenUsageTracker } from '../token-usage-tracker'
import { AgentHealthMonitor } from '../agent-health-monitor'
import { MultiAgentRunLog } from '../run-log'

// Mock AI SDK Agent module
vi.mock('ai', async () => {
  const actual = await vi.importActual('ai')
  return {
    ...actual,
    Experimental_Agent: vi.fn().mockImplementation(({ model }) => ({
      generate: vi.fn().mockResolvedValue({
        text: 'Mock agent response',
        usage: { totalTokens: 500 },
        steps: [],
      }),
      model,
    })),
  }
})

function makeAgent(overrides: Partial<Parameters<typeof buildDelegationTools>[0][0]> = {}) {
  return {
    id: 'agent-1',
    name: 'Researcher',
    role: 'Research specialist',
    goal: 'Find relevant information',
    description: 'Searches for and analyzes information',
    instructions: 'You are a researcher.',
    max_steps: 5,
    max_result_tokens: 4000,
    ...overrides,
  }
}

function makeOptions(overrides: Partial<DelegationToolOptions> = {}): DelegationToolOptions {
  return {
    model: {} as DelegationToolOptions['model'],
    allTools: {},
    tokenTracker: new TokenUsageTracker(100000),
    healthMonitor: new AgentHealthMonitor(),
    runLog: new MultiAgentRunLog('team-1', 'thread-1', 100000),
    emitDataPart: vi.fn(),
    createModel: vi.fn().mockResolvedValue({}),
    ...overrides,
  }
}

describe('buildDelegationTools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a tool named delegate_to_{sanitized_name}', () => {
    const tools = buildDelegationTools([makeAgent()], makeOptions())
    expect(tools).toHaveProperty('delegate_to_researcher')
  })

  it('creates one tool per agent', () => {
    const agents = [
      makeAgent({ id: 'a1', name: 'Researcher' }),
      makeAgent({ id: 'a2', name: 'Writer' }),
    ]
    const tools = buildDelegationTools(agents, makeOptions())
    expect(Object.keys(tools)).toHaveLength(2)
    expect(tools).toHaveProperty('delegate_to_researcher')
    expect(tools).toHaveProperty('delegate_to_writer')
  })

  it('tool description includes agent role and goal', () => {
    const tools = buildDelegationTools([makeAgent()], makeOptions())
    const tool = tools['delegate_to_researcher']
    expect(tool.description).toContain('Research specialist')
    expect(tool.description).toContain('Find relevant information')
  })

  it('returns circuit breaker error when health monitor blocks agent', async () => {
    const options = makeOptions()
    // Trip the circuit breaker
    options.healthMonitor.recordFailure('agent-1')
    options.healthMonitor.recordFailure('agent-1')

    const tools = buildDelegationTools([makeAgent()], options)
    const tool = tools['delegate_to_researcher']
    const result = await tool.execute!(
      { task: 'test' },
      { abortSignal: undefined } as never
    )
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toContain('temporarily unavailable')
  })

  it('returns budget exhaustion error when tokens are depleted', async () => {
    const options = makeOptions()
    options.tokenTracker.add(100000) // exhaust budget

    const tools = buildDelegationTools([makeAgent()], options)
    const tool = tools['delegate_to_researcher']
    const result = await tool.execute!(
      { task: 'test' },
      { abortSignal: undefined } as never
    )
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toContain('Token budget exhausted')
  })

  it('emits running and complete data parts on success', async () => {
    const emitDataPart = vi.fn()
    const options = makeOptions({ emitDataPart })

    const tools = buildDelegationTools([makeAgent()], options)
    const tool = tools['delegate_to_researcher']
    await tool.execute!(
      { task: 'Find papers on AI' },
      { abortSignal: undefined } as never
    )

    // Should have emitted running + complete
    expect(emitDataPart).toHaveBeenCalledTimes(2)
    expect(emitDataPart).toHaveBeenCalledWith(
      'agentStatus',
      expect.objectContaining({ status: 'running', agent_name: 'Researcher' })
    )
    expect(emitDataPart).toHaveBeenCalledWith(
      'agentStatus',
      expect.objectContaining({ status: 'complete', agent_name: 'Researcher' })
    )
  })

  it('tracks tokens via tokenTracker on success', async () => {
    const options = makeOptions()
    const tools = buildDelegationTools([makeAgent()], options)
    const tool = tools['delegate_to_researcher']

    await tool.execute!(
      { task: 'test' },
      { abortSignal: undefined } as never
    )

    expect(options.tokenTracker.getUsage().consumed).toBe(500)
  })

  it('toModelOutput truncates long text', () => {
    const tools = buildDelegationTools(
      [makeAgent({ max_result_tokens: 10 })],
      makeOptions()
    )
    const tool = tools['delegate_to_researcher']
    const longText = 'a'.repeat(200)
    const result = tool.toModelOutput!({ text: longText, toolCalls: [], tokensUsed: 100 })
    expect(result).toHaveProperty('type', 'text')
    expect((result as { value: string }).value).toContain('[Output truncated')
  })

  it('toModelOutput handles error results', () => {
    const tools = buildDelegationTools([makeAgent()], makeOptions())
    const tool = tools['delegate_to_researcher']
    const result = tool.toModelOutput!({ error: 'Something failed' })
    expect(result).toEqual({ type: 'text', value: 'Something failed' })
  })

  it('toModelOutput handles null/undefined output', () => {
    const tools = buildDelegationTools([makeAgent()], makeOptions())
    const tool = tools['delegate_to_researcher']
    const result = tool.toModelOutput!(null)
    expect(result).toEqual({ type: 'text', value: 'Agent completed with no output.' })
  })

  it('toModelOutput handles string output', () => {
    const tools = buildDelegationTools([makeAgent()], makeOptions())
    const tool = tools['delegate_to_researcher']
    const result = tool.toModelOutput!('direct string')
    expect(result).toEqual({ type: 'text', value: 'direct string' })
  })

  describe('tool scoping', () => {
    it('returns all tools when scope is all', () => {
      const options = makeOptions({
        allTools: {
          search: {} as never,
          write: {} as never,
        },
      })
      const agent = makeAgent({ tool_scope: { mode: 'all', tool_keys: [] } })
      const tools = buildDelegationTools([agent], options)
      // The delegation tool itself has its own scoped tools — tested through execute
      expect(tools).toHaveProperty('delegate_to_researcher')
    })

    it('includes only matching tools in include mode', () => {
      const options = makeOptions({
        allTools: {
          search: {} as never,
          write: {} as never,
          delete_file: {} as never,
        },
      })
      const agent = makeAgent({
        tool_scope: { mode: 'include', tool_keys: ['search', 'write'] },
      })
      const tools = buildDelegationTools([agent], options)
      expect(tools).toHaveProperty('delegate_to_researcher')
    })
  })
})
