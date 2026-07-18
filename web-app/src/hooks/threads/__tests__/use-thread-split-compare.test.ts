import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useThreadSplit } from '../use-thread-split'
import { useThreads } from '@/hooks/threads/useThreads'

// Mock SESSION_STORAGE_KEY (same pattern as use-thread-split.test.ts)
vi.mock('@/constants/chat', () => ({
  SESSION_STORAGE_KEY: {
    SPLIT_VIEW_INFO: 'split-view-info',
    INITIAL_MESSAGE_TEMPORARY: 'initial-message-temporary',
    NEW_THREAD_PROMPT: 'new-thread-prompt',
  },
  SESSION_STORAGE_PREFIX: {
    INITIAL_MESSAGE: 'initial-message-',
  },
  TEMPORARY_CHAT_ID: 'temporary-chat',
}))

vi.mock('@/hooks/threads/useThreads', () => {
  const createFn = vi.fn().mockResolvedValue({ id: 'new-thread-1' })
  const updateFn = vi.fn()

  const store = Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({ createThread: createFn, updateThread: updateFn }),
    {
      getState: vi.fn(() => ({
        threads: {},
        createThread: createFn,
        updateThread: updateFn,
      })),
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

const modelA: ThreadModel = { id: 'model-a', provider: 'provider-a' }
const modelB: ThreadModel = { id: 'model-b', provider: 'provider-b' }

describe('useThreadSplit — compare mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
  })

  it('starts with compare mode off', () => {
    const { result } = renderHook(() =>
      useThreadSplit({
        thread: makeThread(),
        selectedModel: makeModel(),
        selectedProvider: 'openai',
      })
    )

    expect(result.current.compareModels).toBeNull()
  })

  it('handleCompare binds the main thread to modelA and creates a second thread bound to modelB', async () => {
    const { result } = renderHook(() =>
      useThreadSplit({
        thread: makeThread(),
        selectedModel: makeModel(),
        selectedProvider: 'openai',
      })
    )

    await act(async () => {
      await result.current.handleCompare(modelA, modelB)
    })

    const { updateThread, createThread } = useThreads.getState() as unknown as {
      updateThread: ReturnType<typeof vi.fn>
      createThread: ReturnType<typeof vi.fn>
    }

    // Main pane rebound to the first (distinct) model.
    expect(updateThread).toHaveBeenCalledWith('thread-1', { model: modelA })
    // Second pane created with the second (distinct) model, titled by model id.
    expect(createThread).toHaveBeenCalledTimes(1)
    expect(createThread.mock.calls[0][0]).toEqual(modelB)
    expect(createThread.mock.calls[0][1]).toBe('model-b')

    expect(result.current.compareModels).toEqual([modelA, modelB])
    expect(result.current.splitThreadId).toBe('new-thread-1')
    expect(result.current.splitDirection).toBe('right')
    expect(result.current.splitPaneOrder).toEqual(['main', 'split'])
  })

  it('handleCompare rebinds the existing split thread instead of creating a new one', async () => {
    sessionStorage.setItem(
      'split-view-info',
      JSON.stringify({ splitThreadId: 'split-existing', direction: 'right' })
    )

    const { result } = renderHook(() =>
      useThreadSplit({
        thread: makeThread(),
        selectedModel: makeModel(),
        selectedProvider: 'openai',
      })
    )

    await act(async () => {
      await result.current.handleCompare(modelA, modelB)
    })

    const { updateThread, createThread } = useThreads.getState() as unknown as {
      updateThread: ReturnType<typeof vi.fn>
      createThread: ReturnType<typeof vi.fn>
    }

    expect(createThread).not.toHaveBeenCalled()
    expect(updateThread).toHaveBeenCalledWith('thread-1', { model: modelA })
    expect(updateThread).toHaveBeenCalledWith('split-existing', {
      model: modelB,
    })
    expect(result.current.splitThreadId).toBe('split-existing')
    expect(result.current.compareModels).toEqual([modelA, modelB])
  })

  it('closeSplit clears both split view and compare mode', async () => {
    const { result } = renderHook(() =>
      useThreadSplit({
        thread: makeThread(),
        selectedModel: makeModel(),
        selectedProvider: 'openai',
      })
    )

    await act(async () => {
      await result.current.handleCompare(modelA, modelB)
    })
    expect(result.current.compareModels).not.toBeNull()

    act(() => {
      result.current.closeSplit()
    })

    expect(result.current.compareModels).toBeNull()
    expect(result.current.splitThreadId).toBeNull()
    expect(result.current.splitDirection).toBeNull()
    expect(result.current.splitPaneOrder).toBeNull()
  })

  it('handleSplit exits compare mode but keeps the split panes', async () => {
    const { result } = renderHook(() =>
      useThreadSplit({
        thread: makeThread(),
        selectedModel: makeModel(),
        selectedProvider: 'openai',
      })
    )

    await act(async () => {
      await result.current.handleCompare(modelA, modelB)
    })

    await act(async () => {
      await result.current.handleSplit('left')
    })

    expect(result.current.compareModels).toBeNull()
    expect(result.current.splitThreadId).toBe('new-thread-1')
    expect(result.current.splitDirection).toBe('left')
  })

  it('handleCompare reports errors via toast and keeps compare mode off', async () => {
    const { createThread } = useThreads.getState() as unknown as {
      createThread: ReturnType<typeof vi.fn>
    }
    createThread.mockRejectedValueOnce(new Error('boom'))

    const { result } = renderHook(() =>
      useThreadSplit({
        thread: makeThread(),
        selectedModel: makeModel(),
        selectedProvider: 'openai',
      })
    )

    await act(async () => {
      await result.current.handleCompare(modelA, modelB)
    })

    expect(result.current.compareModels).toBeNull()
    expect(result.current.splitThreadId).toBeNull()
  })
})
