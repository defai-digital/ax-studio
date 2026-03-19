import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useResearchPanel } from '@/hooks/useResearchPanel'
import { useThreadResearch } from '../use-thread-research'

const mockStartResearch = vi.fn()

vi.mock('@/hooks/useResearch', () => ({
  useResearch: () => ({
    startResearch: mockStartResearch,
  }),
}))

describe('useThreadResearch', () => {
  const threadId = 'thread-1'

  beforeEach(() => {
    mockStartResearch.mockClear()
    act(() => {
      useResearchPanel.setState({ dataByThread: {} })
    })
  })

  describe('pinnedResearch', () => {
    it('returns null when no research is pinned', () => {
      const { result } = renderHook(() => useThreadResearch(threadId))
      expect(result.current.pinnedResearch).toBeNull()
    })

    it('returns pinned research when present', () => {
      act(() => {
        useResearchPanel.getState().openResearch(threadId, 'test query', 2)
      })

      const { result } = renderHook(() => useThreadResearch(threadId))
      expect(result.current.pinnedResearch).not.toBeNull()
      expect(result.current.pinnedResearch!.query).toBe('test query')
      expect(result.current.pinnedResearch!.depth).toBe(2)
    })
  })

  describe('clearResearch', () => {
    it('clears research for a thread', () => {
      act(() => {
        useResearchPanel.getState().openResearch(threadId, 'q', 2)
      })

      const { result } = renderHook(() => useThreadResearch(threadId))
      expect(result.current.pinnedResearch).not.toBeNull()

      act(() => {
        result.current.clearResearch(threadId)
      })

      expect(useResearchPanel.getState().getPinned(threadId)).toBeNull()
    })
  })

  describe('handleResearchCommand', () => {
    it('returns false for non-research commands', () => {
      const { result } = renderHook(() => useThreadResearch(threadId))
      expect(result.current.handleResearchCommand('hello world')).toBe(false)
      expect(result.current.handleResearchCommand('/help')).toBe(false)
      expect(result.current.handleResearchCommand('/remember something')).toBe(false)
    })

    it('returns true and starts standard research for /research query', () => {
      const { result } = renderHook(() => useThreadResearch(threadId))

      const handled = result.current.handleResearchCommand('/research quantum computing')
      expect(handled).toBe(true)
      expect(mockStartResearch).toHaveBeenCalledWith('quantum computing', 2)
    })

    it('returns true and starts deep research for /research:deep query', () => {
      const { result } = renderHook(() => useThreadResearch(threadId))

      const handled = result.current.handleResearchCommand('/research:deep quantum computing')
      expect(handled).toBe(true)
      expect(mockStartResearch).toHaveBeenCalledWith('quantum computing', 3)
    })

    it('returns true and starts deep research for /research:3 query', () => {
      const { result } = renderHook(() => useThreadResearch(threadId))

      const handled = result.current.handleResearchCommand('/research:3 AI safety')
      expect(handled).toBe(true)
      expect(mockStartResearch).toHaveBeenCalledWith('AI safety', 3)
    })

    it('returns true and starts standard research for /research:standard query', () => {
      const { result } = renderHook(() => useThreadResearch(threadId))

      const handled = result.current.handleResearchCommand('/research:standard climate change')
      expect(handled).toBe(true)
      expect(mockStartResearch).toHaveBeenCalledWith('climate change', 2)
    })

    it('returns false when /research has no query', () => {
      const { result } = renderHook(() => useThreadResearch(threadId))

      const handled = result.current.handleResearchCommand('/research')
      expect(handled).toBe(false)
      expect(mockStartResearch).not.toHaveBeenCalled()
    })

    it('returns false when /research:deep has no query', () => {
      const { result } = renderHook(() => useThreadResearch(threadId))

      const handled = result.current.handleResearchCommand('/research:deep')
      expect(handled).toBe(false)
      expect(mockStartResearch).not.toHaveBeenCalled()
    })

    it('handles leading whitespace', () => {
      const { result } = renderHook(() => useThreadResearch(threadId))

      const handled = result.current.handleResearchCommand('  /research test')
      expect(handled).toBe(true)
      expect(mockStartResearch).toHaveBeenCalledWith('test', 2)
    })

    it('is case-insensitive for the command prefix', () => {
      const { result } = renderHook(() => useThreadResearch(threadId))

      const handled = result.current.handleResearchCommand('/Research test')
      expect(handled).toBe(true)
    })

    it('parses /research:Deep as deep research (case-insensitive)', () => {
      const { result } = renderHook(() => useThreadResearch(threadId))

      const handled = result.current.handleResearchCommand('/research:Deep my query')
      expect(handled).toBe(true)
      expect(mockStartResearch).toHaveBeenCalledWith('my query', 3)
    })
  })

  describe('startResearch', () => {
    it('exposes startResearch from useResearch', () => {
      const { result } = renderHook(() => useThreadResearch(threadId))
      expect(result.current.startResearch).toBe(mockStartResearch)
    })
  })
})
