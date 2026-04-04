import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SendMessagesOptions } from './transport-types'

// ─── Hoisted mocks ───

const {
  mockConvertToModelMessages,
  mockCreateUIMessageStream,
  mockStepCountIs,
  mockGetTeam,
  mockAssistantStore,
  mockProviderState,
  mockCreateModel,
  mockValidateTeamAgentNames,
  mockEstimateTeamRunCost,
  mockPersistRunLog,
} = vi.hoisted(() => ({
  mockConvertToModelMessages: vi.fn(),
  mockCreateUIMessageStream: vi.fn(),
  mockStepCountIs: vi.fn(),
  mockGetTeam: vi.fn(),
  mockAssistantStore: {
    assistants: [] as unknown[],
    currentAssistant: null as null | Record<string, unknown>,
  },
  mockProviderState: {
    selectedProvider: 'openai',
    selectedModel: { id: 'gpt-4o' } as { id: string } | null,
    getProviderByName: vi.fn().mockReturnValue({ id: 'openai', provider: 'openai' }),
  },
  mockCreateModel: vi.fn().mockResolvedValue({ id: 'mock-model' }),
  mockValidateTeamAgentNames: vi.fn().mockReturnValue(null),
  mockEstimateTeamRunCost: vi.fn(),
  mockPersistRunLog: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('ai', () => ({
  Experimental_Agent: vi.fn(),
  convertToModelMessages: mockConvertToModelMessages,
  createUIMessageStream: mockCreateUIMessageStream,
  stepCountIs: mockStepCountIs,
}))

vi.mock('@/features/multi-agent/stores/agent-team-store', () => ({
  useAgentTeamStore: {
    getState: () => ({ getTeam: mockGetTeam }),
  },
}))

vi.mock('@/features/assistants/hooks/useAssistant', () => ({
  useAssistant: {
    getState: () => mockAssistantStore,
  },
}))

vi.mock('@/features/models/hooks/useModelProvider', () => ({
  useModelProvider: {
    getState: () => mockProviderState,
  },
}))

vi.mock('@/features/threads/hooks/useThreads', () => ({
  useThreads: {
    getState: () => ({
      updateThread: vi.fn(),
    }),
  },
}))

vi.mock('@/lib/model-factory', () => ({
  ModelFactory: {
    createModel: (...args: unknown[]) => mockCreateModel(...args),
  },
}))

vi.mock('@/features/multi-agent/lib', () => ({
  TokenUsageTracker: vi.fn().mockImplementation(() => ({
    budgetExhausted: vi.fn().mockReturnValue('budget-stop'),
  })),
  AgentHealthMonitor: vi.fn().mockImplementation(() => ({})),
  MultiAgentRunLog: vi.fn().mockImplementation(() => ({
    setOrchestratorTokens: vi.fn(),
    getData: vi.fn().mockReturnValue({ steps: [] }),
    complete: vi.fn(),
    getUsage: vi.fn().mockReturnValue({ consumed: 100 }),
    fail: vi.fn(),
  })),
  persistRunLog: (...args: unknown[]) => mockPersistRunLog(...args),
  validateTeamAgentNames: (...args: unknown[]) => mockValidateTeamAgentNames(...args),
  estimateTeamRunCost: (...args: unknown[]) => mockEstimateTeamRunCost(...args),
}))

vi.mock('@/features/multi-agent/lib/delegation-tools', () => ({
  buildDelegationTools: vi.fn().mockReturnValue({}),
}))

vi.mock('@/features/multi-agent/lib/parallel-orchestration', () => ({
  buildParallelOrchestration: vi.fn().mockReturnValue({ tools: {}, system: 'parallel system' }),
}))

vi.mock('@/features/multi-agent/lib/orchestrator-prompt', () => ({
  buildOrchestratorPrompt: vi.fn().mockReturnValue('orchestrator system prompt'),
  resolveVariables: vi.fn().mockImplementation((system) => system),
}))

vi.mock('@/features/multi-agent/lib/sanitize', () => ({
  sanitize: vi.fn().mockImplementation((name: string) => name.toLowerCase().replace(/\s+/g, '_')),
}))

import { executeMultiAgentStream, type MultiAgentConfig } from './multi-agent-transport'

function makeOptions(overrides: Partial<SendMessagesOptions> = {}): SendMessagesOptions {
  return {
    chatId: 'chat-1',
    messages: [{ id: 'm1', role: 'user' as const, parts: [{ type: 'text' as const, text: 'hi' }] }],
    abortSignal: undefined,
    trigger: 'submit-message',
    messageId: 'msg-1',
    ...overrides,
  }
}

function makeConfig(overrides: Partial<MultiAgentConfig> = {}): MultiAgentConfig {
  return {
    teamId: 'team-1',
    model: { id: 'model' } as MultiAgentConfig['model'],
    tools: {},
    systemMessage: undefined,
    threadId: 'thread-1',
    inferenceParameters: {},
    modelOverrideId: undefined,
    onTokenUsage: undefined,
    costApprovalCallback: undefined,
    getThreadMetadata: () => ({}),
    mapUserInlineAttachments: (msgs) => msgs,
    refreshTools: vi.fn().mockResolvedValue(undefined),
    onFallbackToSingleAgent: vi.fn().mockResolvedValue(new ReadableStream()),
    ...overrides,
  }
}

describe('executeMultiAgentStream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTeam.mockReturnValue({
      id: 'team-1',
      agent_ids: ['a1', 'a2'],
      orchestration: { mode: 'router' },
      token_budget: 50000,
    })
    mockAssistantStore.assistants = [
      { id: 'a1', name: 'Agent One' },
      { id: 'a2', name: 'Agent Two' },
    ]
    mockProviderState.selectedModel = { id: 'gpt-4o' }
    mockProviderState.getProviderByName = vi.fn().mockReturnValue({ id: 'openai', provider: 'openai' })
    mockConvertToModelMessages.mockReturnValue([])
    mockCreateModel.mockResolvedValue({ id: 'mock-model' })
    mockPersistRunLog.mockResolvedValue(undefined)
    mockValidateTeamAgentNames.mockReturnValue(null)
    mockCreateUIMessageStream.mockImplementation(() => new ReadableStream())
  })

  // ─── Phase 1: Team validation ───

  it('falls back when team is not found', async () => {
    mockGetTeam.mockReturnValue(null)

    const fallback = vi.fn().mockResolvedValue(new ReadableStream())

    await executeMultiAgentStream(makeOptions(), makeConfig({ onFallbackToSingleAgent: fallback }))

    expect(fallback).toHaveBeenCalled()
  })

  it('falls back when no agents are found', async () => {
    mockAssistantStore.assistants = []
    const fallback = vi.fn().mockResolvedValue(new ReadableStream())

    await executeMultiAgentStream(makeOptions(), makeConfig({ onFallbackToSingleAgent: fallback }))

    expect(fallback).toHaveBeenCalled()
  })

  it('falls back when agent name validation fails', async () => {
    mockValidateTeamAgentNames.mockReturnValue('Duplicate agent names detected')
    const fallback = vi.fn().mockResolvedValue(new ReadableStream())

    await executeMultiAgentStream(makeOptions(), makeConfig({ onFallbackToSingleAgent: fallback }))

    expect(fallback).toHaveBeenCalled()
  })

  // ─── Phase 2: Provider/model resolution ───

  it('falls back when provider is not found', async () => {
    mockProviderState.getProviderByName = vi.fn().mockReturnValue(null)
    const fallback = vi.fn().mockResolvedValue(new ReadableStream())

    await executeMultiAgentStream(makeOptions(), makeConfig({ onFallbackToSingleAgent: fallback }))

    expect(fallback).toHaveBeenCalled()
  })

  it('falls back when no model is selected', async () => {
    mockProviderState.selectedModel = null
    const fallback = vi.fn().mockResolvedValue(new ReadableStream())

    await executeMultiAgentStream(
      makeOptions(),
      makeConfig({ modelOverrideId: undefined, onFallbackToSingleAgent: fallback })
    )

    expect(fallback).toHaveBeenCalled()
  })

  // ─── Phase 3: Cost approval ───

  it('falls back when cost exceeds threshold and user rejects', async () => {
    mockGetTeam.mockReturnValue({
      id: 'team-1',
      agent_ids: ['a1'],
      orchestration: { mode: 'router' },
      cost_approval_threshold: 0.5,
    })
    mockAssistantStore.assistants = [{ id: 'a1', name: 'Agent' }]
    mockEstimateTeamRunCost.mockReturnValue({ range: { min: 0, max: 1.0 } })

    const costCallback = vi.fn().mockResolvedValue(false)
    const fallback = vi.fn().mockResolvedValue(new ReadableStream())

    await executeMultiAgentStream(
      makeOptions(),
      makeConfig({
        costApprovalCallback: costCallback,
        onFallbackToSingleAgent: fallback,
      })
    )

    expect(costCallback).toHaveBeenCalled()
    expect(fallback).toHaveBeenCalled()
  })

  it('proceeds past cost check when approved (falls back due to mock Agent)', async () => {
    mockGetTeam.mockReturnValue({
      id: 'team-1',
      agent_ids: ['a1'],
      orchestration: { mode: 'router' },
      cost_approval_threshold: 0.5,
    })
    mockAssistantStore.assistants = [{ id: 'a1', name: 'Agent' }]
    mockEstimateTeamRunCost.mockReturnValue({ range: { min: 0, max: 1.0 } })

    const costCallback = vi.fn().mockResolvedValue(true)
    const fallback = vi.fn().mockResolvedValue(new ReadableStream())

    const result = await executeMultiAgentStream(
      makeOptions(),
      makeConfig({ costApprovalCallback: costCallback, onFallbackToSingleAgent: fallback })
    )

    // Cost callback was invoked and approved
    expect(costCallback).toHaveBeenCalled()
    // But the mocked Agent constructor doesn't produce a real agent,
    // so it fails further and falls back
    expect(result).toBeInstanceOf(ReadableStream)
  })

  // ─── Phase 4: AbortError rethrow ───

  it('rethrows AbortError instead of falling back', async () => {
    const abortError = new Error('Aborted')
    abortError.name = 'AbortError'
    mockGetTeam.mockImplementation(() => {
      throw abortError
    })

    await expect(
      executeMultiAgentStream(makeOptions(), makeConfig())
    ).rejects.toThrow('Aborted')
  })

  // ─── Phase 5: Fallback behavior ───

  it('calls onFallbackToSingleAgent on generic errors', async () => {
    mockGetTeam.mockImplementation(() => {
      throw new Error('generic failure')
    })

    const fallback = vi.fn().mockResolvedValue(new ReadableStream())

    await executeMultiAgentStream(
      makeOptions(),
      makeConfig({ onFallbackToSingleAgent: fallback })
    )

    expect(fallback).toHaveBeenCalledWith(expect.objectContaining({ chatId: 'chat-1' }))
  })

  it('calls refreshTools during initialization (verified via mock)', async () => {
    // refreshTools is called early in the flow before Agent construction.
    // Even though the mocked Agent fails later and falls back,
    // refreshTools should have been called.
    const refreshTools = vi.fn().mockResolvedValue(undefined)
    const fallback = vi.fn().mockResolvedValue(new ReadableStream())

    await executeMultiAgentStream(
      makeOptions(),
      makeConfig({ refreshTools, onFallbackToSingleAgent: fallback })
    )

    expect(refreshTools).toHaveBeenCalled()
  })

  it('uses modelOverrideId when provided', async () => {
    const fallback = vi.fn().mockResolvedValue(new ReadableStream())

    await executeMultiAgentStream(
      makeOptions(),
      makeConfig({ modelOverrideId: 'custom-model', onFallbackToSingleAgent: fallback })
    )

    // ModelFactory.createModel is called with the override model
    expect(mockCreateModel).toHaveBeenCalledWith(
      'custom-model',
      expect.anything(),
      expect.anything()
    )
  })

  it('persists run log on failure when runLog was created', async () => {
    // Error after runLog is created (after validation passes but Agent fails)
    const fallback = vi.fn().mockResolvedValue(new ReadableStream())

    await executeMultiAgentStream(
      makeOptions(),
      makeConfig({ onFallbackToSingleAgent: fallback })
    )

    // The mocked Agent constructor returns undefined which causes an error
    // after runLog is created, so persistRunLog should be called
    expect(mockPersistRunLog).toHaveBeenCalled()
    expect(fallback).toHaveBeenCalled()
  })

  it('does not persist run log when error occurs before creation', async () => {
    mockGetTeam.mockImplementation(() => {
      throw new Error('some error')
    })

    const fallback = vi.fn().mockResolvedValue(new ReadableStream())

    await executeMultiAgentStream(
      makeOptions(),
      makeConfig({ onFallbackToSingleAgent: fallback })
    )

    // runLog is null when error happens before it's created
    expect(mockPersistRunLog).not.toHaveBeenCalled()
    expect(fallback).toHaveBeenCalled()
  })
})
