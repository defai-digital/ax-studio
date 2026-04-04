import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useThreadTools } from './use-thread-tools'

// Mock ai SDK
vi.mock('ai', () => ({
  lastAssistantMessageIsCompleteWithToolCalls: vi.fn(() => false),
}))

// Mock zustand stores
vi.mock('@/hooks/useThreads', () => {
  const store = Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        threads: {},
        updateThread: vi.fn(),
      }),
    {
      getState: vi.fn(() => ({ threads: {}, updateThread: vi.fn() })),
      setState: vi.fn(),
      subscribe: vi.fn(),
      destroy: vi.fn(),
    }
  )
  return { useThreads: store }
})

vi.mock('@/stores/agent-team-store', () => {
  const store = Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        teams: [],
        isLoaded: true,
        loadTeams: vi.fn(),
      }),
    {
      getState: vi.fn(() => ({
        teams: [],
        isLoaded: true,
        loadTeams: vi.fn(),
      })),
      setState: vi.fn(),
      subscribe: vi.fn(),
      destroy: vi.fn(),
    }
  )
  return { useAgentTeamStore: store }
})

vi.mock('@/hooks/useToolApproval', () => {
  const store = Object.assign(
    vi.fn(() => ({})),
    {
      getState: vi.fn(() => ({
        showApprovalModal: vi.fn().mockResolvedValue(true),
      })),
      setState: vi.fn(),
      subscribe: vi.fn(),
      destroy: vi.fn(),
    }
  )
  return { useToolApproval: store }
})

vi.mock('@/hooks/useAppState', () => {
  const store = Object.assign(
    vi.fn(() => ({})),
    {
      getState: vi.fn(() => ({
        mcpToolNames: new Set(['test_tool']),
      })),
      setState: vi.fn(),
      subscribe: vi.fn(),
      destroy: vi.fn(),
    }
  )
  return { useAppState: store }
})

vi.mock('@/stores/chat-session-store', () => {
  const mockSessionData = {
    tools: [],
    isStreaming: false,
    chat: { messages: [] },
  }
  const store = Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        getSessionData: () => mockSessionData,
        sessions: {},
      }),
    {
      getState: vi.fn(() => ({
        sessions: {},
        getSessionData: () => mockSessionData,
      })),
      setState: vi.fn(),
      subscribe: vi.fn(),
      destroy: vi.fn(),
    }
  )
  return {
    useChatSessions: store,
    isSessionBusy: vi.fn(() => false),
  }
})

describe('useThreadTools', () => {
  const threadId = 'thread-1'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the expected shape', () => {
    const { result } = renderHook(() =>
      useThreadTools({ threadId, projectId: undefined })
    )

    expect(result.current.toolCallAbortController).toBeDefined()
    expect(typeof result.current.followUpMessage).toBe('function')
    expect(typeof result.current.onToolCall).toBe('function')
    expect(typeof result.current.startToolExecution).toBe('function')
    expect(typeof result.current.onCostApproval).toBe('function')
    expect(result.current.costApprovalState).toBeNull()
    expect(typeof result.current.setCostApprovalState).toBe('function')
    expect(Array.isArray(result.current.agentTeams)).toBe(true)
    expect(result.current.activeTeamId).toBeUndefined()
    expect(result.current.activeTeam).toBeUndefined()
    expect(typeof result.current.showVariablePrompt).toBe('boolean')
    expect(typeof result.current.handleVariableSubmit).toBe('function')
    expect(typeof result.current.handleTeamChange).toBe('function')
  })

  describe('followUpMessage', () => {
    it('returns false when toolCallAbortController is null', () => {
      const { result } = renderHook(() =>
        useThreadTools({ threadId, projectId: undefined })
      )

      expect(result.current.followUpMessage({ messages: [] })).toBe(false)
    })

    it('returns false when abort controller is aborted', () => {
      const { result } = renderHook(() =>
        useThreadTools({ threadId, projectId: undefined })
      )

      const controller = new AbortController()
      controller.abort()
      result.current.toolCallAbortController.current = controller

      expect(result.current.followUpMessage({ messages: [] })).toBe(false)
    })

    it('returns false when all tool calls are delegation tools', () => {
      const { result } = renderHook(() =>
        useThreadTools({ threadId, projectId: undefined })
      )

      result.current.toolCallAbortController.current = new AbortController()

      const messages = [
        {
          id: 'msg-1',
          role: 'assistant' as const,
          parts: [
            {
              type: 'tool-invocation',
              toolInvocation: { toolName: 'delegate_to_agent1' },
            },
          ],
        },
      ]

      expect(
        result.current.followUpMessage({ messages: messages as any }) // eslint-disable-line @typescript-eslint/no-explicit-any
      ).toBe(false)
    })

    it('returns false when tool call is run_all_agents_parallel', () => {
      const { result } = renderHook(() =>
        useThreadTools({ threadId, projectId: undefined })
      )

      result.current.toolCallAbortController.current = new AbortController()

      const messages = [
        {
          id: 'msg-1',
          role: 'assistant' as const,
          parts: [
            {
              type: 'tool-invocation',
              toolInvocation: { toolName: 'run_all_agents_parallel' },
            },
          ],
        },
      ]

      expect(
        result.current.followUpMessage({ messages: messages as any }) // eslint-disable-line @typescript-eslint/no-explicit-any
      ).toBe(false)
    })
  })

  describe('onToolCall', () => {
    it('skips delegation tools', () => {
      const { result } = renderHook(() =>
        useThreadTools({ threadId, projectId: undefined })
      )

      act(() => {
        result.current.onToolCall({
          toolCall: {
            toolName: 'delegate_to_agent1',
            toolCallId: 'tc-1',
            input: {},
          },
        })
      })

      // Delegation tools should not be queued
      // This verifies it doesn't throw
    })

    it('skips run_all_agents_parallel', () => {
      const { result } = renderHook(() =>
        useThreadTools({ threadId, projectId: undefined })
      )

      act(() => {
        result.current.onToolCall({
          toolCall: {
            toolName: 'run_all_agents_parallel',
            toolCallId: 'tc-1',
            input: {},
          },
        })
      })
      // Should not throw
    })
  })

  describe('onCostApproval', () => {
    it('returns a promise and sets costApprovalState', async () => {
      const { result } = renderHook(() =>
        useThreadTools({ threadId, projectId: undefined })
      )

      let promise: Promise<boolean> | undefined

      act(() => {
        promise = result.current.onCostApproval({
          totalCost: 0.5,
          inputTokens: 1000,
          outputTokens: 500,
        } as any) // eslint-disable-line @typescript-eslint/no-explicit-any
      })

      expect(result.current.costApprovalState).not.toBeNull()
      expect(result.current.costApprovalState!.estimate).toEqual({
        totalCost: 0.5,
        inputTokens: 1000,
        outputTokens: 500,
      })

      // Resolve the approval
      act(() => {
        result.current.costApprovalState!.resolve(true)
      })

      const approved = await promise
      expect(approved).toBe(true)
    })
  })

  describe('agent team state', () => {
    it('returns empty agentTeams array', () => {
      const { result } = renderHook(() =>
        useThreadTools({ threadId, projectId: undefined })
      )

      expect(result.current.agentTeams).toEqual([])
    })

    it('returns undefined activeTeamId when thread has no team', () => {
      const { result } = renderHook(() =>
        useThreadTools({ threadId, projectId: undefined })
      )

      expect(result.current.activeTeamId).toBeUndefined()
    })

    it('teamHasVariables is false when no active team', () => {
      const { result } = renderHook(() =>
        useThreadTools({ threadId, projectId: undefined })
      )

      expect(result.current.teamHasVariables).toBe(false)
    })

    it('variablesFilled is false when no thread metadata', () => {
      const { result } = renderHook(() =>
        useThreadTools({ threadId, projectId: undefined })
      )

      expect(result.current.variablesFilled).toBe(false)
    })

    it('showVariablePrompt defaults to false', () => {
      const { result } = renderHook(() =>
        useThreadTools({ threadId, projectId: undefined })
      )

      expect(result.current.showVariablePrompt).toBe(false)
    })

    it('setShowVariablePrompt updates state', () => {
      const { result } = renderHook(() =>
        useThreadTools({ threadId, projectId: undefined })
      )

      act(() => {
        result.current.setShowVariablePrompt(true)
      })

      expect(result.current.showVariablePrompt).toBe(true)
    })

    it('teamTokensUsed defaults to 0', () => {
      const { result } = renderHook(() =>
        useThreadTools({ threadId, projectId: undefined })
      )

      expect(result.current.teamTokensUsed).toBe(0)
    })

    it('setTeamTokensUsed updates state', () => {
      const { result } = renderHook(() =>
        useThreadTools({ threadId, projectId: undefined })
      )

      act(() => {
        result.current.setTeamTokensUsed(1500)
      })

      expect(result.current.teamTokensUsed).toBe(1500)
    })
  })

  describe('handleTeamChange', () => {
    it('is a function', () => {
      const { result } = renderHook(() =>
        useThreadTools({ threadId, projectId: undefined })
      )

      expect(typeof result.current.handleTeamChange).toBe('function')
    })
  })

  describe('handleVariableSubmit', () => {
    it('is a function', () => {
      const { result } = renderHook(() =>
        useThreadTools({ threadId, projectId: undefined })
      )

      expect(typeof result.current.handleVariableSubmit).toBe('function')
    })
  })

  describe('toolCallAbortController', () => {
    it('is initially null', () => {
      const { result } = renderHook(() =>
        useThreadTools({ threadId, projectId: undefined })
      )

      expect(result.current.toolCallAbortController.current).toBeNull()
    })
  })
})
