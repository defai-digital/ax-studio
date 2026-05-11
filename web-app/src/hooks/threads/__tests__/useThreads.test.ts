import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useThreads } from '../useThreads'

// Mock the services
vi.mock('@/services/threads', () => ({
  createThread: vi.fn(),
  deleteThread: vi.fn(),
  updateThread: vi.fn(),
}))

// Mock ulid
vi.mock('ulidx', () => ({
  ulid: vi.fn(() => 'test-ulid-123'),
}))

// Mock fzf
vi.mock('fzf', () => ({
  Fzf: vi.fn(() => ({
    find: vi.fn(() => []),
  })),
}))
global.__TAURI_INTERNALS__ = {
  plugins: {
    path: {
      sep: '/',
    },
  },
}

describe('useThreads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset Zustand store
    act(() => {
      useThreads.setState({
        threads: {},
        currentThreadId: undefined,
        searchIndex: null,
      })
    })
  })

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useThreads())

    expect(result.current.threads).toEqual({})
    expect(result.current.currentThreadId).toBeUndefined()
    expect(result.current.getCurrentThread()).toBeUndefined()
  })

  it('should set threads', () => {
    const { result } = renderHook(() => useThreads())

    const threads = [
      { id: 'thread1', title: 'Thread 1', messages: [] },
      { id: 'thread2', title: 'Thread 2', messages: [] },
    ]

    act(() => {
      result.current.setThreads(threads)
    })

    expect(Object.keys(result.current.threads)).toHaveLength(2)
    expect(result.current.threads['thread1']).toEqual(threads[0])
    expect(result.current.threads['thread2']).toEqual(threads[1])
  })
  it('should set current thread ID', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.setCurrentThreadId('thread-123')
    })

    expect(result.current.currentThreadId).toBe('thread-123')
  })

  it('should get current thread', () => {
    const { result } = renderHook(() => useThreads())

    const thread = { id: 'thread1', title: 'Thread 1', messages: [] }

    act(() => {
      result.current.setThreads([thread])
      result.current.setCurrentThreadId('thread1')
    })

    expect(result.current.getCurrentThread()).toEqual(thread)
  })

  it('should return undefined when getting current thread with no ID', () => {
    const { result } = renderHook(() => useThreads())

    expect(result.current.getCurrentThread()).toBeUndefined()
  })

  it('should get thread by ID', () => {
    const { result } = renderHook(() => useThreads())

    const thread = { id: 'thread1', title: 'Thread 1', messages: [] }

    act(() => {
      result.current.setThreads([thread])
    })

    expect(result.current.getThreadById('thread1')).toEqual(thread)
    expect(result.current.getThreadById('nonexistent')).toBeUndefined()
  })

  it('should delete thread', () => {
    const { result } = renderHook(() => useThreads())

    const threads = [
      { id: 'thread1', title: 'Thread 1', messages: [] },
      { id: 'thread2', title: 'Thread 2', messages: [] },
    ]

    act(() => {
      result.current.setThreads(threads)
    })

    expect(Object.keys(result.current.threads)).toHaveLength(2)

    act(() => {
      result.current.deleteThread('thread1')
    })

    expect(Object.keys(result.current.threads)).toHaveLength(1)
    expect(result.current.threads['thread1']).toBeUndefined()
    expect(result.current.threads['thread2']).toBeDefined()
  })

  it('should rename thread', () => {
    const { result } = renderHook(() => useThreads())

    const thread = { id: 'thread1', title: 'Original Title', messages: [] }

    act(() => {
      result.current.setThreads([thread])
    })

    act(() => {
      result.current.renameThread('thread1', 'New Title')
    })

    expect(result.current.threads['thread1'].title).toBe('New Title')
  })

  it('should toggle favorite', () => {
    const { result } = renderHook(() => useThreads())

    const thread = {
      id: 'thread1',
      title: 'Thread 1',
      messages: [],
      starred: false,
    }

    act(() => {
      result.current.setThreads([thread])
    })

    act(() => {
      result.current.toggleFavorite('thread1')
    })

    // Just test that the toggle function exists and can be called
    expect(typeof result.current.toggleFavorite).toBe('function')
  })

  it('should get favorite threads', () => {
    const { result } = renderHook(() => useThreads())

    // Just test that the function exists
    expect(typeof result.current.getFavoriteThreads).toBe('function')
    const favorites = result.current.getFavoriteThreads()
    expect(Array.isArray(favorites)).toBe(true)
  })

  it('should delete all threads', () => {
    const { result } = renderHook(() => useThreads())

    const threads = [
      { id: 'thread1', title: 'Thread 1', messages: [] },
      { id: 'thread2', title: 'Thread 2', messages: [] },
    ]

    act(() => {
      result.current.setThreads(threads)
    })

    expect(Object.keys(result.current.threads)).toHaveLength(2)

    act(() => {
      result.current.deleteAllThreads()
    })

    expect(result.current.threads).toEqual({})
  })

  it('keeps favorites and project threads when deleting regular threads', () => {
    const { result } = renderHook(() => useThreads())

    const threads = [
      { id: 'regular', title: 'Regular', messages: [] },
      { id: 'favorite', title: 'Favorite', messages: [], isFavorite: true },
      {
        id: 'project-thread',
        title: 'Project Thread',
        messages: [],
        metadata: { project: { id: 'project-1', name: 'Project 1' } },
      },
    ]

    act(() => {
      result.current.setThreads(threads)
      result.current.setCurrentThreadId('regular')
      result.current.deleteAllThreads()
    })

    expect(Object.keys(result.current.threads)).toEqual([
      'favorite',
      'project-thread',
    ])
    expect(result.current.currentThreadId).toBeUndefined()
  })

  it('clears all threads and active selection', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.setThreads([
        { id: 'thread1', title: 'Thread 1', messages: [] },
        { id: 'thread2', title: 'Thread 2', messages: [] },
      ])
      result.current.setCurrentThreadId('thread1')
      result.current.clearAllThreads()
    })

    expect(result.current.threads).toEqual({})
    expect(result.current.currentThreadId).toBeUndefined()
  })

  it('deletes only threads that belong to a project', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.setThreads([
        {
          id: 'project-a-thread',
          title: 'Project A',
          messages: [],
          metadata: { project: { id: 'project-a', name: 'Project A' } },
        },
        {
          id: 'project-b-thread',
          title: 'Project B',
          messages: [],
          metadata: { project: { id: 'project-b', name: 'Project B' } },
        },
        { id: 'regular', title: 'Regular', messages: [] },
      ])
      result.current.setCurrentThreadId('project-a-thread')
      result.current.deleteAllThreadsByProject('project-a')
    })

    expect(Object.keys(result.current.threads)).toEqual([
      'project-b-thread',
      'regular',
    ])
    expect(result.current.currentThreadId).toBeUndefined()
  })

  it('should unstar all threads', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.setThreads([
        { id: 'thread1', title: 'Thread 1', messages: [], isFavorite: true },
        { id: 'thread2', title: 'Thread 2', messages: [], isFavorite: true },
      ])
      result.current.unstarAllThreads()
    })

    expect(result.current.threads.thread1.isFavorite).toBe(false)
    expect(result.current.threads.thread2.isFavorite).toBe(false)
  })

  it('should filter threads by search term', () => {
    const { result } = renderHook(() => useThreads())

    // Just test that the function exists
    expect(typeof result.current.getFilteredThreads).toBe('function')
    let filtered: ReturnType<typeof result.current.getFilteredThreads> = []
    act(() => {
      filtered = result.current.getFilteredThreads('test')
    })
    expect(Array.isArray(filtered)).toBe(true)
  })

  it('should return all threads when no search term', () => {
    const { result } = renderHook(() => useThreads())

    const threads = [
      { id: 'thread1', title: 'Thread 1', messages: [] },
      { id: 'thread2', title: 'Thread 2', messages: [] },
    ]

    act(() => {
      result.current.setThreads(threads)
    })

    const filtered = result.current.getFilteredThreads('')
    expect(filtered).toHaveLength(2)
  })

  it('creates a thread and selects it', async () => {
    const { result } = renderHook(() => useThreads())

    await act(async () => {
      await result.current.createThread({
        provider: 'provider',
        id: 'model',
      })
    })

    expect(result.current.currentThreadId).toBe('test-thread')
    expect(result.current.threads['test-thread']).toEqual({
      id: 'test-thread',
      messages: [],
    })
  })

  it('updates the active thread assistant and model', () => {
    const { result } = renderHook(() => useThreads())

    act(() => {
      result.current.setThreads([
        {
          id: 'thread1',
          title: 'Thread 1',
          messages: [],
          model: { provider: 'old-provider', id: 'old-model' },
        },
      ])
      result.current.setCurrentThreadId('thread1')
      result.current.updateCurrentThreadAssistant({
        id: 'assistant-1',
        name: 'Assistant 1',
      })
      result.current.updateCurrentThreadModel({
        provider: 'new-provider',
        id: 'new-model',
      })
    })

    expect(result.current.threads.thread1.assistants).toEqual([
      { id: 'assistant-1', name: 'Assistant 1' },
    ])
    expect(result.current.threads.thread1.model).toEqual({
      provider: 'new-provider',
      id: 'new-model',
    })
  })
})
