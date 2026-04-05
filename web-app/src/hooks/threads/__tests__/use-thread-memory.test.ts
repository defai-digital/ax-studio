import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMemory } from '@/hooks/integrations/useMemory'
import { useThreadMemory } from '../use-thread-memory'

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock memory-extractor
vi.mock('@/lib/memory-extractor', () => ({
  parseMemoryDelta: vi.fn((text: string) => {
    const match = text.match(/<memory_extract>([\s\S]*?)<\/memory_extract>/)
    if (!match) return { ops: [], cleanedText: text }
    const cleanedText = text.replace(/<memory_extract>[\s\S]*?<\/memory_extract>/, '').trimEnd()
    return { ops: [], cleanedText }
  }),
  applyMemoryDelta: vi.fn(
    (existing: unknown[]) => existing
  ),
  buildMemoryContext: vi.fn((memories: Array<{ fact: string }>) => {
    if (memories.length === 0) return ''
    return `\n\n## Memory\n${memories.map((m) => `- ${m.fact}`).join('\n')}`
  }),
  extractFactsFromPatterns: vi.fn(() => new Map()),
  mergePatternFacts: vi.fn(
    (existing: unknown[]) => existing
  ),
}))

// Mock chat-session-store
vi.mock('@/stores/chat-session-store', () => ({
  useChatSessions: Object.assign(
    vi.fn(() => ({})),
    {
      getState: vi.fn(() => ({
        sessions: {},
      })),
      setState: vi.fn(),
      subscribe: vi.fn(),
      destroy: vi.fn(),
    }
  ),
}))

describe('useThreadMemory', () => {
  const threadId = 'thread-1'

  beforeEach(() => {
    useMemory.setState({
      memories: {},
      memoryEnabled: false,
      memoryEnabledPerThread: {},
      memoryVersion: 0,
    })
    vi.clearAllMocks()
  })

  describe('memorySuffix', () => {
    it('returns empty string when memory is disabled', () => {
      const { result } = renderHook(() => useThreadMemory(threadId))
      expect(result.current.memorySuffix).toBe('')
    })

    it('returns memory context when memory is enabled globally', () => {
      useMemory.setState({
        memoryEnabled: true,
        memories: {
          default: [
            {
              id: 'mem-1',
              fact: 'User likes cats',
              sourceThreadId: threadId,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
        },
      })

      const { result } = renderHook(() => useThreadMemory(threadId))
      expect(result.current.memorySuffix).toContain('Memory')
      expect(result.current.memorySuffix).toContain('User likes cats')
    })

    it('returns empty string when memory is enabled but no memories exist', () => {
      useMemory.setState({
        memoryEnabled: true,
        memories: { default: [] },
      })

      const { result } = renderHook(() => useThreadMemory(threadId))
      expect(result.current.memorySuffix).toBe('')
    })

    it('respects per-thread memory override', () => {
      useMemory.setState({
        memoryEnabled: false,
        memoryEnabledPerThread: { [threadId]: true },
        memories: {
          default: [
            {
              id: 'mem-1',
              fact: 'User is a dev',
              sourceThreadId: threadId,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
        },
      })

      const { result } = renderHook(() => useThreadMemory(threadId))
      expect(result.current.memorySuffix).toContain('User is a dev')
    })
  })

  describe('handleRememberCommand', () => {
    it('returns false for non-remember commands', () => {
      const { result } = renderHook(() => useThreadMemory(threadId))
      expect(result.current.handleRememberCommand('hello world')).toBe(false)
      expect(result.current.handleRememberCommand('/forget test')).toBe(false)
    })

    it('returns true for /remember command', () => {
      const { result } = renderHook(() => useThreadMemory(threadId))
      const handled = result.current.handleRememberCommand('/remember I like pizza')
      expect(handled).toBe(true)
    })

    it('adds memory when /remember has a fact', () => {
      const { result } = renderHook(() => useThreadMemory(threadId))

      act(() => {
        result.current.handleRememberCommand('/remember I like pizza')
      })

      const memories = useMemory.getState().getMemories('default')
      expect(memories.length).toBe(1)
      expect(memories[0].fact).toBe('I like pizza')
      expect(memories[0].category).toBe('manual')
      expect(memories[0].sourceThreadId).toBe(threadId)
    })

    it('shows toast on successful remember', async () => {
      const { toast } = await import('sonner')
      const { result } = renderHook(() => useThreadMemory(threadId))

      act(() => {
        result.current.handleRememberCommand('/remember I like pizza')
      })

      expect(toast.success).toHaveBeenCalledWith('Remembered: "I like pizza"')
    })

    it('returns true but does not add memory when fact is empty', () => {
      const { result } = renderHook(() => useThreadMemory(threadId))

      act(() => {
        result.current.handleRememberCommand('/remember ')
      })

      // Still returns true (command consumed)
      expect(result.current.handleRememberCommand('/remember ')).toBe(true)
      // But no memory added since fact is empty after trim
    })
  })

  describe('handleForgetCommand', () => {
    it('returns false for non-forget commands', () => {
      const { result } = renderHook(() => useThreadMemory(threadId))
      expect(result.current.handleForgetCommand('hello')).toBe(false)
      expect(result.current.handleForgetCommand('/remember test')).toBe(false)
    })

    it('returns true for /forget command', () => {
      const { result } = renderHook(() => useThreadMemory(threadId))
      expect(result.current.handleForgetCommand('/forget pizza')).toBe(true)
    })

    it('deletes matching memory', async () => {
      useMemory.setState({
        memories: {
          default: [
            {
              id: 'mem-1',
              fact: 'I like pizza',
              sourceThreadId: threadId,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
        },
      })

      const { toast } = await import('sonner')
      const { result } = renderHook(() => useThreadMemory(threadId))

      act(() => {
        result.current.handleForgetCommand('/forget pizza')
      })

      const memories = useMemory.getState().getMemories('default')
      expect(memories.length).toBe(0)
      expect(toast.success).toHaveBeenCalledWith('Forgot: "I like pizza"')
    })

    it('shows info toast when no matching memory found', async () => {
      const { toast } = await import('sonner')
      const { result } = renderHook(() => useThreadMemory(threadId))

      act(() => {
        result.current.handleForgetCommand('/forget nonexistent')
      })

      expect(toast.info).toHaveBeenCalledWith(
        'No memory found matching "nonexistent"'
      )
    })

    it('matches case-insensitively', () => {
      useMemory.setState({
        memories: {
          default: [
            {
              id: 'mem-1',
              fact: 'I like PIZZA',
              sourceThreadId: threadId,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          ],
        },
      })

      const { result } = renderHook(() => useThreadMemory(threadId))

      act(() => {
        result.current.handleForgetCommand('/forget pizza')
      })

      const memories = useMemory.getState().getMemories('default')
      expect(memories.length).toBe(0)
    })
  })

  describe('refs', () => {
    it('exposes lastUserInputRef', () => {
      const { result } = renderHook(() => useThreadMemory(threadId))
      expect(result.current.lastUserInputRef).toBeDefined()
      expect(result.current.lastUserInputRef.current).toBe('')
    })

    it('exposes processedMemoryMsgIds as a Set ref', () => {
      const { result } = renderHook(() => useThreadMemory(threadId))
      expect(result.current.processedMemoryMsgIds.current).toBeInstanceOf(Set)
      expect(result.current.processedMemoryMsgIds.current.size).toBe(0)
    })
  })

  describe('processMemoryOnFinish', () => {
    it('is a function', () => {
      const { result } = renderHook(() => useThreadMemory(threadId))
      expect(typeof result.current.processMemoryOnFinish).toBe('function')
    })

    it('tracks message ID even when contentParts is empty', () => {
      const { result } = renderHook(() => useThreadMemory(threadId))

      const mockMessage = {
        id: 'msg-1',
        role: 'assistant' as const,
        parts: [],
      }

      act(() => {
        result.current.processMemoryOnFinish(
          mockMessage as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          [],
          vi.fn()
        )
      })

      // Message ID is tracked even though there were no content parts to process
      expect(result.current.processedMemoryMsgIds.current.has('msg-1')).toBe(true)
    })

    it('tracks processed message IDs to avoid double processing', () => {
      const { result } = renderHook(() => useThreadMemory(threadId))

      const mockMessage = {
        id: 'msg-1',
        role: 'assistant' as const,
        parts: [{ type: 'text', text: 'Hello' }],
      }

      const contentParts = [
        { type: 'text', text: { value: 'Hello', annotations: [] } },
      ]

      act(() => {
        result.current.processMemoryOnFinish(
          mockMessage as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          contentParts as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          vi.fn()
        )
      })

      expect(result.current.processedMemoryMsgIds.current.has('msg-1')).toBe(true)
    })
  })
})
