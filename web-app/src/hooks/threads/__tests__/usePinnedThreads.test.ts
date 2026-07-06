import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
    get length() {
      return Object.keys(store).length
    },
    key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
})

describe('usePinnedThreads', () => {
  // Re-import the module for each test so module-level state resets
  let usePinnedThreads: typeof import('../usePinnedThreads').usePinnedThreads

  beforeEach(async () => {
    localStorageMock.clear()
    vi.clearAllMocks()
    vi.resetModules()
    const mod = await import('../usePinnedThreads')
    usePinnedThreads = mod.usePinnedThreads
  })

  it('should return pinnedIds array', () => {
    const { result } = renderHook(() => usePinnedThreads())
    expect(Array.isArray(result.current.pinnedIds)).toBe(true)
    expect(result.current.pinnedIds).toHaveLength(0)
  })

  it('sanitizes persisted pinned thread ids on startup', async () => {
    localStorageMock.setItem(
      'ax-pinned-threads',
      JSON.stringify([
        ' thread-1 ',
        '',
        'thread-1',
        42,
        ...Array.from({ length: 205 }, (_, index) => `thread-${index + 2}`),
      ])
    )
    vi.resetModules()
    const mod = await import('../usePinnedThreads')

    const { result } = renderHook(() => mod.usePinnedThreads())

    expect(result.current.pinnedIds).toHaveLength(200)
    expect(result.current.pinnedIds[0]).toBe('thread-1')
    expect(result.current.pinnedIds[1]).toBe('thread-2')
    expect(result.current.pinnedIds).not.toContain('')
    expect(result.current.pinnedIds).not.toContain(42)
    expect(new Set(result.current.pinnedIds).size).toBe(200)
  })

  it('should toggle pin a thread and update pinnedIds', () => {
    const { result } = renderHook(() => usePinnedThreads())

    act(() => {
      result.current.togglePin('thread-1')
    })

    expect(result.current.pinnedIds).toContain('thread-1')
  })

  it('should unpin a thread when toggled twice', () => {
    const { result } = renderHook(() => usePinnedThreads())

    act(() => {
      result.current.togglePin('thread-1')
    })
    expect(result.current.pinnedIds).toContain('thread-1')

    act(() => {
      result.current.togglePin('thread-1')
    })
    expect(result.current.pinnedIds).not.toContain('thread-1')
  })

  it('ignores blank thread ids when toggling', () => {
    const { result } = renderHook(() => usePinnedThreads())

    act(() => {
      result.current.togglePin('   ')
    })

    expect(result.current.pinnedIds).toEqual([])
    expect(localStorageMock.setItem).not.toHaveBeenCalledWith(
      'ax-pinned-threads',
      expect.any(String)
    )
  })

  it('should persist to localStorage on pin', () => {
    const { result } = renderHook(() => usePinnedThreads())

    act(() => {
      result.current.togglePin('thread-1')
    })

    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      'ax-pinned-threads',
      expect.any(String),
    )
    // Find the last setItem call for ax-pinned-threads
    const calls = localStorageMock.setItem.mock.calls.filter(
      (c: string[]) => c[0] === 'ax-pinned-threads',
    )
    const lastCall = calls[calls.length - 1]
    const saved = JSON.parse(lastCall[1] as string)
    expect(saved).toContain('thread-1')
  })

  it('should reorder pinned threads', () => {
    const { result } = renderHook(() => usePinnedThreads())

    act(() => {
      result.current.togglePin('thread-1')
    })
    act(() => {
      result.current.togglePin('thread-2')
    })
    act(() => {
      result.current.reorder(['thread-2', 'thread-1'])
    })

    expect(result.current.pinnedIds[0]).toBe('thread-2')
    expect(result.current.pinnedIds[1]).toBe('thread-1')
  })

  it('sanitizes reordered pinned threads before persisting', () => {
    const { result } = renderHook(() => usePinnedThreads())

    act(() => {
      result.current.reorder(['thread-2', '', 'thread-2', ' thread-1 '])
    })

    expect(result.current.pinnedIds).toEqual(['thread-2', 'thread-1'])
    const calls = localStorageMock.setItem.mock.calls.filter(
      (c: string[]) => c[0] === 'ax-pinned-threads',
    )
    const lastCall = calls[calls.length - 1]
    expect(JSON.parse(lastCall[1] as string)).toEqual([
      'thread-2',
      'thread-1',
    ])
  })

  it('should provide a pinnedSet that is a Set', () => {
    const { result } = renderHook(() => usePinnedThreads())
    expect(result.current.pinnedSet).toBeInstanceOf(Set)
  })

  it('should return false for isPinned on unknown thread', () => {
    const { result } = renderHook(() => usePinnedThreads())
    expect(result.current.isPinned('nonexistent')).toBe(false)
  })
})
