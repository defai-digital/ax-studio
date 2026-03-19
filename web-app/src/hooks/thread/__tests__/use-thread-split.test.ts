import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useThreadSplit } from '../use-thread-split'
import { useThreads } from '@/hooks/useThreads'

// Mock SESSION_STORAGE_KEY
vi.mock('@/constants/chat', () => ({
  SESSION_STORAGE_KEY: {
    SPLIT_VIEW_INFO: 'split-view-info',
    INITIAL_MESSAGE_TEMPORARY: 'initial-message-temporary',
    NEW_THREAD_PROMPT: 'new-thread-prompt',
    NEW_THREAD_TEAM_ID: 'new-thread-team-id',
  },
  SESSION_STORAGE_PREFIX: {
    INITIAL_MESSAGE: 'initial-message-',
  },
  TEMPORARY_CHAT_ID: 'temporary-chat',
}))

const mockCreateThread = vi.fn()

vi.mock('@/hooks/useThreads', () => {
  const createFn = vi.fn().mockResolvedValue({ id: 'new-thread-1' })

  const store = Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({ createThread: createFn }),
    {
      getState: vi.fn(() => ({ threads: {}, createThread: createFn })),
      setState: vi.fn(),
      subscribe: vi.fn(),
      destroy: vi.fn(),
    }
  )

  return { useThreads: store }
})

const makeThread = (overrides: Record<string, unknown> = {}): Thread =>
  ({
    id: 'thread-1',
    title: 'Test Thread',
    updated: Date.now() / 1000,
    model: { id: 'gpt-4o', provider: 'openai' },
    assistants: [{ id: 'a1', name: 'Assistant' }],
    metadata: {},
    ...overrides,
  }) as unknown as Thread

const makeModel = (overrides: Record<string, unknown> = {}): Model =>
  ({
    id: 'gpt-4o',
    ...overrides,
  }) as unknown as Model

describe('useThreadSplit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
  })

  it('initializes with null split direction and splitThreadId', () => {
    const { result } = renderHook(() =>
      useThreadSplit({
        thread: makeThread(),
        selectedModel: makeModel(),
        selectedProvider: 'openai',
      })
    )

    expect(result.current.splitDirection).toBeNull()
    expect(result.current.splitThreadId).toBeNull()
    expect(result.current.splitPaneOrder).toBeNull()
  })

  it('reads split view info from sessionStorage on init', () => {
    sessionStorage.setItem(
      'split-view-info',
      JSON.stringify({ splitThreadId: 'split-t1', direction: 'left' })
    )

    const { result } = renderHook(() =>
      useThreadSplit({
        thread: makeThread(),
        selectedModel: makeModel(),
        selectedProvider: 'openai',
      })
    )

    expect(result.current.splitDirection).toBe('left')
    expect(result.current.splitThreadId).toBe('split-t1')
  })

  it('removes sessionStorage after reading split info', () => {
    sessionStorage.setItem(
      'split-view-info',
      JSON.stringify({ splitThreadId: 'split-t1', direction: 'right' })
    )

    renderHook(() =>
      useThreadSplit({
        thread: makeThread(),
        selectedModel: makeModel(),
        selectedProvider: 'openai',
      })
    )

    // sessionStorage is cleared by the splitThreadId initializer
    expect(sessionStorage.getItem('split-view-info')).toBeNull()
  })

  describe('splitPaneOrder', () => {
    it('returns null when no split is active', () => {
      const { result } = renderHook(() =>
        useThreadSplit({
          thread: makeThread(),
          selectedModel: makeModel(),
          selectedProvider: 'openai',
        })
      )

      expect(result.current.splitPaneOrder).toBeNull()
    })

    it('returns ["split", "main"] for left direction', () => {
      sessionStorage.setItem(
        'split-view-info',
        JSON.stringify({ splitThreadId: 'split-t1', direction: 'left' })
      )

      const { result } = renderHook(() =>
        useThreadSplit({
          thread: makeThread(),
          selectedModel: makeModel(),
          selectedProvider: 'openai',
        })
      )

      expect(result.current.splitPaneOrder).toEqual(['split', 'main'])
    })

    it('returns ["main", "split"] for right direction', () => {
      sessionStorage.setItem(
        'split-view-info',
        JSON.stringify({ splitThreadId: 'split-t1', direction: 'right' })
      )

      const { result } = renderHook(() =>
        useThreadSplit({
          thread: makeThread(),
          selectedModel: makeModel(),
          selectedProvider: 'openai',
        })
      )

      expect(result.current.splitPaneOrder).toEqual(['main', 'split'])
    })
  })

  describe('setSplitDirection', () => {
    it('updates split direction', () => {
      const { result } = renderHook(() =>
        useThreadSplit({
          thread: makeThread(),
          selectedModel: makeModel(),
          selectedProvider: 'openai',
        })
      )

      act(() => {
        result.current.setSplitDirection('right')
      })

      expect(result.current.splitDirection).toBe('right')
    })

    it('can set direction to null', () => {
      const { result } = renderHook(() =>
        useThreadSplit({
          thread: makeThread(),
          selectedModel: makeModel(),
          selectedProvider: 'openai',
        })
      )

      act(() => {
        result.current.setSplitDirection('left')
      })
      act(() => {
        result.current.setSplitDirection(null)
      })

      expect(result.current.splitDirection).toBeNull()
    })
  })

  describe('setSplitThreadId', () => {
    it('updates split thread ID', () => {
      const { result } = renderHook(() =>
        useThreadSplit({
          thread: makeThread(),
          selectedModel: makeModel(),
          selectedProvider: 'openai',
        })
      )

      act(() => {
        result.current.setSplitThreadId('some-thread')
      })

      expect(result.current.splitThreadId).toBe('some-thread')
    })
  })

  describe('handleSplit', () => {
    it('only changes direction if splitThreadId already exists', async () => {
      sessionStorage.setItem(
        'split-view-info',
        JSON.stringify({ splitThreadId: 'existing-split', direction: 'left' })
      )

      const { result } = renderHook(() =>
        useThreadSplit({
          thread: makeThread(),
          selectedModel: makeModel(),
          selectedProvider: 'openai',
        })
      )

      await act(async () => {
        await result.current.handleSplit('right')
      })

      expect(result.current.splitDirection).toBe('right')
      expect(result.current.splitThreadId).toBe('existing-split')
    })
  })
})
