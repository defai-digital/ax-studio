import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLeftPanel } from '../useLeftPanel'

// Mock constants
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    LeftPanel: 'left-panel-settings',
  },
}))

describe('useLeftPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store state to defaults
    const store = useLeftPanel.getState()
    store.setLeftPanel(true)
    store.setLeftPanelSize(20)
    store.setLeftPanelWidth('15rem')
  })

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useLeftPanel())

    expect(result.current.open).toBe(true)
    expect(result.current.size).toBe(20)
    expect(result.current.width).toBe('15rem')
    expect(typeof result.current.setLeftPanel).toBe('function')
  })

  describe('setLeftPanel', () => {
    it('should open the left panel', () => {
      const { result } = renderHook(() => useLeftPanel())

      act(() => {
        result.current.setLeftPanel(true)
      })

      expect(result.current.open).toBe(true)
    })

    it('should close the left panel', () => {
      const { result } = renderHook(() => useLeftPanel())

      act(() => {
        result.current.setLeftPanel(false)
      })

      expect(result.current.open).toBe(false)
    })

    it('should toggle panel state multiple times', () => {
      const { result } = renderHook(() => useLeftPanel())

      const testSequence = [false, true, false, true, false]

      testSequence.forEach((open) => {
        act(() => {
          result.current.setLeftPanel(open)
        })

        expect(result.current.open).toBe(open)
      })
    })

    it('should handle setting the same value multiple times', () => {
      const { result } = renderHook(() => useLeftPanel())

      // Set to false multiple times
      act(() => {
        result.current.setLeftPanel(false)
        result.current.setLeftPanel(false)
        result.current.setLeftPanel(false)
      })
      expect(result.current.open).toBe(false)

      // Set to true multiple times
      act(() => {
        result.current.setLeftPanel(true)
        result.current.setLeftPanel(true)
        result.current.setLeftPanel(true)
      })
      expect(result.current.open).toBe(true)
    })
  })

  describe('setLeftPanelSize', () => {
    it('clamps size to the valid percentage range', () => {
      const { result } = renderHook(() => useLeftPanel())

      act(() => {
        result.current.setLeftPanelSize(-10)
      })
      expect(result.current.size).toBe(0)

      act(() => {
        result.current.setLeftPanelSize(120)
      })
      expect(result.current.size).toBe(100)
    })

    it('ignores non-finite sizes', () => {
      const { result } = renderHook(() => useLeftPanel())

      act(() => {
        result.current.setLeftPanelSize(Number.NaN)
      })
      expect(result.current.size).toBe(20)
    })
  })

  describe('setLeftPanelWidth', () => {
    it('normalizes valid width strings', () => {
      const { result } = renderHook(() => useLeftPanel())

      act(() => {
        result.current.setLeftPanelWidth(' 18.5rem ')
      })

      expect(result.current.width).toBe('18.5rem')
    })

    it('falls back for malformed width strings', () => {
      const { result } = renderHook(() => useLeftPanel())

      act(() => {
        result.current.setLeftPanelWidth('calc(100vw)')
      })

      expect(result.current.width).toBe('15rem')
    })
  })

  describe('state persistence', () => {
    it('should maintain state across multiple hook instances', () => {
      const { result: result1 } = renderHook(() => useLeftPanel())
      const { result: result2 } = renderHook(() => useLeftPanel())

      act(() => {
        result1.current.setLeftPanel(false)
      })

      expect(result2.current.open).toBe(false)

      act(() => {
        result2.current.setLeftPanel(true)
      })

      expect(result1.current.open).toBe(true)
      expect(result2.current.open).toBe(true)
    })

    it('sanitizes malformed persisted state during merge', () => {
      const current = useLeftPanel.getState()
      const merge = useLeftPanel.persist.getOptions().merge

      const merged = merge?.(
        {
          open: 'true',
          size: Number.POSITIVE_INFINITY,
          width: 'javascript:alert(1)',
        },
        current
      )

      expect(merged).toEqual(
        expect.objectContaining({
          open: true,
          size: 20,
          width: '15rem',
        })
      )
    })

    it('hydrates valid persisted state during merge', () => {
      const current = useLeftPanel.getState()
      const merge = useLeftPanel.persist.getOptions().merge

      const merged = merge?.(
        {
          open: false,
          size: 125,
          width: '320px',
        },
        current
      )

      expect(merged).toEqual(
        expect.objectContaining({
          open: false,
          size: 100,
          width: '320px',
        })
      )
    })
  })

  describe('edge cases', () => {
    it('should handle rapid state changes', () => {
      const { result } = renderHook(() => useLeftPanel())

      act(() => {
        // Rapid toggle
        result.current.setLeftPanel(false)
        result.current.setLeftPanel(true)
        result.current.setLeftPanel(false)
        result.current.setLeftPanel(true)
      })

      expect(result.current.open).toBe(true)
    })

    it('should preserve state type safety', () => {
      const { result } = renderHook(() => useLeftPanel())

      act(() => {
        result.current.setLeftPanel(false)
      })

      expect(typeof result.current.open).toBe('boolean')
      expect(result.current.open).toBe(false)

      act(() => {
        result.current.setLeftPanel(true)
      })

      expect(typeof result.current.open).toBe('boolean')
      expect(result.current.open).toBe(true)
    })
  })
})
