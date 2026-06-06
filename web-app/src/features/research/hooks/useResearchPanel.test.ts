import { describe, it, expect, beforeEach } from 'vitest'
import { act } from '@testing-library/react'
import { useResearchPanel, type ResearchEntry } from './useResearchPanel'

const getState = () => useResearchPanel.getState()

describe('useResearchPanel', () => {
  beforeEach(() => {
    act(() => {
      useResearchPanel.setState({ dataByThread: {} })
    })
  })

  describe('initial state', () => {
    it('starts with empty dataByThread', () => {
      expect(getState().dataByThread).toEqual({})
    })
  })

  describe('getPinned', () => {
    it('returns null for unknown thread', () => {
      expect(getState().getPinned('unknown')).toBeNull()
    })

    it('returns the research entry for a known thread', () => {
      act(() => {
        getState().openResearch('t1', 'test query', 2)
      })
      const entry = getState().getPinned('t1')
      expect(entry).not.toBeNull()
      expect(entry!.query).toBe('test query')
    })
  })

  describe('openResearch', () => {
    it('creates a research entry with status running', () => {
      act(() => {
        getState().openResearch('t1', 'AI trends', 1)
      })
      const entry = getState().getPinned('t1')!
      expect(entry.status).toBe('running')
    })

    it('initializes with the provided query and depth', () => {
      act(() => {
        getState().openResearch('t1', 'quantum computing', 3)
      })
      const entry = getState().getPinned('t1')!
      expect(entry.query).toBe('quantum computing')
      expect(entry.depth).toBe(3)
    })

    it('initializes with empty steps, sources, and reportMarkdown', () => {
      act(() => {
        getState().openResearch('t1', 'query', 1)
      })
      const entry = getState().getPinned('t1')!
      expect(entry.steps).toEqual([])
      expect(entry.sources).toEqual([])
      expect(entry.reportMarkdown).toBe('')
    })

    it('overwrites existing research for same thread', () => {
      act(() => {
        getState().openResearch('t1', 'first', 1)
      })
      act(() => {
        getState().openResearch('t1', 'second', 2)
      })
      const entry = getState().getPinned('t1')!
      expect(entry.query).toBe('second')
      expect(entry.depth).toBe(2)
    })
  })

  describe('thread isolation', () => {
    it('opening research for thread A does not affect thread B', () => {
      act(() => {
        getState().openResearch('tA', 'query-A', 1)
      })
      expect(getState().getPinned('tB')).toBeNull()
    })

    it('maintains separate entries per thread', () => {
      act(() => {
        getState().openResearch('tA', 'query-A', 1)
        getState().openResearch('tB', 'query-B', 3)
      })
      expect(getState().getPinned('tA')!.query).toBe('query-A')
      expect(getState().getPinned('tB')!.query).toBe('query-B')
    })
  })

  describe('updateResearch', () => {
    it('updates an existing research entry via updater function', () => {
      act(() => {
        getState().openResearch('t1', 'query', 1)
      })
      act(() => {
        getState().updateResearch('t1', (prev) => ({
          ...prev,
          status: 'done',
          reportMarkdown: '# Report',
        }))
      })
      const entry = getState().getPinned('t1')!
      expect(entry.status).toBe('done')
      expect(entry.reportMarkdown).toBe('# Report')
    })

    it('preserves fields not touched by updater', () => {
      act(() => {
        getState().openResearch('t1', 'query', 2)
      })
      act(() => {
        getState().updateResearch('t1', (prev) => ({
          ...prev,
          status: 'done',
        }))
      })
      const entry = getState().getPinned('t1')!
      expect(entry.query).toBe('query')
      expect(entry.depth).toBe(2)
    })

    it('is a no-op when thread has no research entry', () => {
      const stateBefore = { ...getState().dataByThread }
      act(() => {
        getState().updateResearch('nonexistent', (prev) => ({
          ...prev,
          status: 'done',
        }))
      })
      expect(getState().dataByThread).toEqual(stateBefore)
    })

    it('can add steps to the research entry', () => {
      act(() => {
        getState().openResearch('t1', 'query', 1)
      })
      act(() => {
        getState().updateResearch('t1', (prev) => ({
          ...prev,
          steps: [
            ...prev.steps,
            { type: 'searching', query: 'sub-query', timestamp: Date.now() },
          ],
        }))
      })
      expect(getState().getPinned('t1')!.steps).toHaveLength(1)
      expect(getState().getPinned('t1')!.steps[0].type).toBe('searching')
    })

    it('can set error status with error message', () => {
      act(() => {
        getState().openResearch('t1', 'query', 1)
      })
      act(() => {
        getState().updateResearch('t1', (prev) => ({
          ...prev,
          status: 'error',
          error: 'Network failure',
        }))
      })
      const entry = getState().getPinned('t1')!
      expect(entry.status).toBe('error')
      expect(entry.error).toBe('Network failure')
    })

    it('does not affect other threads', () => {
      act(() => {
        getState().openResearch('tA', 'A', 1)
        getState().openResearch('tB', 'B', 2)
      })
      act(() => {
        getState().updateResearch('tA', (prev) => ({
          ...prev,
          status: 'done',
        }))
      })
      expect(getState().getPinned('tB')!.status).toBe('running')
    })
  })

  describe('clearResearch', () => {
    it('removes the research entry for the thread', () => {
      act(() => {
        getState().openResearch('t1', 'query', 1)
      })
      act(() => {
        getState().clearResearch('t1')
      })
      expect(getState().getPinned('t1')).toBeNull()
    })

    it('does not affect other threads', () => {
      act(() => {
        getState().openResearch('tA', 'A', 1)
        getState().openResearch('tB', 'B', 2)
      })
      act(() => {
        getState().clearResearch('tA')
      })
      expect(getState().getPinned('tB')!.query).toBe('B')
    })

    it('is safe to call on unknown thread', () => {
      act(() => {
        getState().clearResearch('nonexistent')
      })
      expect(getState().dataByThread).toEqual({})
    })
  })
})
