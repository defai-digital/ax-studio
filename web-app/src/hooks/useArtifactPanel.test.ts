import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from '@testing-library/react'
import { useArtifactPanel } from './useArtifactPanel'

const getState = () => useArtifactPanel.getState()

describe('useArtifactPanel', () => {
  beforeEach(() => {
    // Reset store to initial state
    act(() => {
      useArtifactPanel.setState({
        pinnedByThread: {},
        historyByThread: {},
      })
    })
  })

  describe('initial state', () => {
    it('starts with empty pinnedByThread', () => {
      expect(getState().pinnedByThread).toEqual({})
    })

    it('starts with empty historyByThread', () => {
      expect(getState().historyByThread).toEqual({})
    })
  })

  describe('getPinned', () => {
    it('returns null for unknown thread', () => {
      expect(getState().getPinned('unknown-thread')).toBeNull()
    })

    it('returns the pinned entry for a known thread', () => {
      act(() => {
        getState().pinArtifact('t1', 'html', '<p>hi</p>')
      })
      const pinned = getState().getPinned('t1')
      expect(pinned).not.toBeNull()
      expect(pinned!.type).toBe('html')
      expect(pinned!.source).toBe('<p>hi</p>')
    })
  })

  describe('pinArtifact', () => {
    it('creates an entry with version 1 on first pin', () => {
      act(() => {
        getState().pinArtifact('t1', 'svg', '<svg/>')
      })
      const pinned = getState().getPinned('t1')
      expect(pinned!.version).toBe(1)
    })

    it('increments version on subsequent pins to same thread', () => {
      act(() => {
        getState().pinArtifact('t1', 'html', 'v1')
      })
      act(() => {
        getState().pinArtifact('t1', 'react', 'v2')
      })
      expect(getState().getPinned('t1')!.version).toBe(2)
    })

    it('sets a timestamp on the entry', () => {
      const before = Date.now()
      act(() => {
        getState().pinArtifact('t1', 'html', 'src')
      })
      const after = Date.now()
      const ts = getState().getPinned('t1')!.timestamp
      expect(ts).toBeGreaterThanOrEqual(before)
      expect(ts).toBeLessThanOrEqual(after)
    })

    it('adds the entry to history', () => {
      act(() => {
        getState().pinArtifact('t1', 'html', 'src')
      })
      const history = getState().historyByThread['t1']
      expect(history).toHaveLength(1)
      expect(history[0].source).toBe('src')
    })

    it('prepends new entries to history (newest first)', () => {
      act(() => {
        getState().pinArtifact('t1', 'html', 'first')
      })
      act(() => {
        getState().pinArtifact('t1', 'html', 'second')
      })
      const history = getState().historyByThread['t1']
      expect(history[0].source).toBe('second')
      expect(history[1].source).toBe('first')
    })

    it('caps history at 20 entries', () => {
      for (let i = 0; i < 25; i++) {
        act(() => {
          getState().pinArtifact('t1', 'html', `src-${i}`)
        })
      }
      expect(getState().historyByThread['t1']).toHaveLength(20)
    })

    it('retains the most recent entries when history is capped', () => {
      for (let i = 0; i < 25; i++) {
        act(() => {
          getState().pinArtifact('t1', 'html', `src-${i}`)
        })
      }
      const history = getState().historyByThread['t1']
      // Most recent is src-24
      expect(history[0].source).toBe('src-24')
      // Oldest retained is src-5
      expect(history[19].source).toBe('src-5')
    })
  })

  describe('thread isolation', () => {
    it('pinning to thread A does not affect thread B', () => {
      act(() => {
        getState().pinArtifact('tA', 'html', 'A-src')
      })
      expect(getState().getPinned('tB')).toBeNull()
    })

    it('maintains separate history per thread', () => {
      act(() => {
        getState().pinArtifact('tA', 'html', 'A')
        getState().pinArtifact('tB', 'svg', 'B')
      })
      expect(getState().historyByThread['tA']).toHaveLength(1)
      expect(getState().historyByThread['tB']).toHaveLength(1)
      expect(getState().historyByThread['tA'][0].type).toBe('html')
      expect(getState().historyByThread['tB'][0].type).toBe('svg')
    })
  })

  describe('clearArtifact', () => {
    it('removes the pinned entry for the thread', () => {
      act(() => {
        getState().pinArtifact('t1', 'html', 'src')
      })
      act(() => {
        getState().clearArtifact('t1')
      })
      expect(getState().getPinned('t1')).toBeNull()
    })

    it('does not remove history when clearing pinned', () => {
      act(() => {
        getState().pinArtifact('t1', 'html', 'src')
      })
      act(() => {
        getState().clearArtifact('t1')
      })
      expect(getState().historyByThread['t1']).toHaveLength(1)
    })

    it('does not affect other threads', () => {
      act(() => {
        getState().pinArtifact('tA', 'html', 'A')
        getState().pinArtifact('tB', 'svg', 'B')
      })
      act(() => {
        getState().clearArtifact('tA')
      })
      expect(getState().getPinned('tB')!.source).toBe('B')
    })

    it('is safe to call on unknown thread', () => {
      act(() => {
        getState().clearArtifact('nonexistent')
      })
      expect(getState().pinnedByThread).toEqual({})
    })
  })

  describe('updateSource', () => {
    it('updates the source of the pinned artifact', () => {
      act(() => {
        getState().pinArtifact('t1', 'html', 'old')
      })
      act(() => {
        getState().updateSource('t1', 'new')
      })
      expect(getState().getPinned('t1')!.source).toBe('new')
    })

    it('increments the version on update', () => {
      act(() => {
        getState().pinArtifact('t1', 'html', 'old')
      })
      act(() => {
        getState().updateSource('t1', 'new')
      })
      expect(getState().getPinned('t1')!.version).toBe(2)
    })

    it('preserves the artifact type on update', () => {
      act(() => {
        getState().pinArtifact('t1', 'chartjs', 'old')
      })
      act(() => {
        getState().updateSource('t1', 'new')
      })
      expect(getState().getPinned('t1')!.type).toBe('chartjs')
    })

    it('adds updated entry to history', () => {
      act(() => {
        getState().pinArtifact('t1', 'html', 'old')
      })
      act(() => {
        getState().updateSource('t1', 'new')
      })
      const history = getState().historyByThread['t1']
      expect(history).toHaveLength(2)
      expect(history[0].source).toBe('new')
    })

    it('is a no-op when no artifact is pinned for the thread', () => {
      act(() => {
        getState().updateSource('unknown', 'src')
      })
      expect(getState().pinnedByThread).toEqual({})
      expect(getState().historyByThread).toEqual({})
    })
  })

  describe('restoreVersion', () => {
    it('sets the pinned artifact to the provided entry', () => {
      act(() => {
        getState().pinArtifact('t1', 'html', 'v1')
      })
      const oldEntry = getState().getPinned('t1')!
      act(() => {
        getState().pinArtifact('t1', 'html', 'v2')
      })
      act(() => {
        getState().restoreVersion('t1', oldEntry)
      })
      expect(getState().getPinned('t1')!.source).toBe('v1')
      expect(getState().getPinned('t1')!.version).toBe(1)
    })

    it('does not add to history on restore', () => {
      act(() => {
        getState().pinArtifact('t1', 'html', 'v1')
      })
      const entry = getState().getPinned('t1')!
      act(() => {
        getState().pinArtifact('t1', 'html', 'v2')
      })
      const historyLengthBefore = getState().historyByThread['t1'].length
      act(() => {
        getState().restoreVersion('t1', entry)
      })
      expect(getState().historyByThread['t1']).toHaveLength(historyLengthBefore)
    })
  })
})
