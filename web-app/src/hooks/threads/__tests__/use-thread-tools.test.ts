import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { UIMessage } from '@ai-sdk/react'
import {
  extractRelevantSourceResult,
  useThreadTools,
} from '../use-thread-tools'

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

  function toolInvocationMessage(toolName: string): UIMessage {
    return {
      id: 'msg-1',
      role: 'assistant',
      parts: [
        {
          type: 'tool-invocation',
          toolInvocation: { toolName },
        },
      ],
    } as UIMessage
  }

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

      expect(
        result.current.followUpMessage({
          messages: [toolInvocationMessage('delegate_to_agent1')],
        })
      ).toBe(false)
    })

    it('returns false when tool call is run_all_agents_parallel', () => {
      const { result } = renderHook(() =>
        useThreadTools({ threadId, projectId: undefined })
      )

      result.current.toolCallAbortController.current = new AbortController()

      expect(
        result.current.followUpMessage({
          messages: [toolInvocationMessage('run_all_agents_parallel')],
        })
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

  describe('extractRelevantSourceResult', () => {
    it('returns null when fabric_extract sets isError even if content looks like extract JSON', async () => {
      const callTool = vi.fn().mockResolvedValue({
        error: '',
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({ text: 'POISONED_EXTRACT_SHOULD_NOT_APPEAR' }),
          },
        ],
      })
      const serviceHub = {
        mcp: () => ({ callTool }),
      } as never

      const searchResult = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              results: [
                {
                  source:
                    '/Users/devop/Documents/akidb-testing/coding-interview-university.md',
                  content:
                    'After going through this study plan, I got hired as a Software Development Engineer at Amazon.',
                  score: 1,
                },
              ],
            }),
          },
        ],
      }

      const extracted = await extractRelevantSourceResult({
        serviceHub,
        result: searchResult,
        query:
          'What real-world hiring outcome did the author of coding interview university achieve?',
      })

      expect(callTool).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'fabric_extract',
          arguments: {
            file_path:
              '/Users/devop/Documents/akidb-testing/coding-interview-university.md',
          },
        })
      )
      // Without getMcpToolFailureMessage, isError content would become extract output
      expect(extracted).toBeNull()
    })

    it('returns extract content when fabric_extract succeeds', async () => {
      const callTool = vi.fn().mockResolvedValue({
        error: '',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              text: 'I got hired as a Software Development Engineer at Amazon.',
            }),
          },
        ],
      })
      const serviceHub = {
        mcp: () => ({ callTool }),
      } as never

      const extracted = await extractRelevantSourceResult({
        serviceHub,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                results: [
                  {
                    source:
                      '/Users/devop/Documents/akidb-testing/coding-interview-university.md',
                    content: 'hired at Amazon',
                    score: 1,
                  },
                ],
              }),
            },
          ],
        },
        query:
          'What real-world hiring outcome did the author of coding interview university achieve?',
      })

      expect(extracted?.content?.[0]?.text).toContain(
        'Software Development Engineer at Amazon'
      )
      expect(extracted?.content?.[0]?.text).toContain('layer')
    })
  })
})
