import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useThreadTools } from '../use-thread-tools'

// Mock ai SDK
vi.mock('ai', () => ({
  lastAssistantMessageIsCompleteWithToolCalls: vi.fn(() => false),
}))

// Mock zustand stores
vi.mock('@/hooks/threads/useThreads', () => {
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

vi.mock('@/hooks/tools/useToolApproval', () => {
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

vi.mock('@/hooks/settings/useAppState', () => {
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
        ensureSessionData: () => mockSessionData,
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
    expect(typeof result.current.resetTurnState).toBe('function')
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

  describe('toolCallAbortController', () => {
    it('is initially null', () => {
      const { result } = renderHook(() =>
        useThreadTools({ threadId, projectId: undefined })
      )

      expect(result.current.toolCallAbortController.current).toBeNull()
    })
  })
})
