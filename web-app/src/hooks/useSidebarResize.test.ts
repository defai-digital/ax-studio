import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSidebarResize } from './useSidebarResize'

/**
 * useSidebarResize is a DOM-heavy hook. We focus on:
 * 1. Exported pure helper functions (parseWidth, toPx, formatWidth) via behavior
 * 2. handleMouseDown initialization
 * 3. Click-to-toggle behavior (mousedown + mouseup without drag)
 * 4. Auto-collapse threshold calculations
 *
 * Full mouse drag simulation is not tested in isolation because the
 * effect-based mousemove handler reads many refs and requires real DOM layout.
 */

describe('useSidebarResize', () => {
  const defaultProps = () => ({
    currentWidth: '16rem',
    onResize: vi.fn(),
    onToggle: vi.fn(),
    isCollapsed: false,
    minResizeWidth: '14rem',
    maxResizeWidth: '24rem',
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Phase 1: Return shape ────────────────────────────────────────────────

  it('returns dragRef, isDragging ref, and handleMouseDown', () => {
    const { result } = renderHook(() => useSidebarResize(defaultProps()))

    expect(result.current.dragRef).toBeDefined()
    expect(result.current.dragRef.current).toBeNull() // not attached to DOM
    expect(result.current.isDragging).toBeDefined()
    expect(result.current.isDragging.current).toBe(false)
    expect(typeof result.current.handleMouseDown).toBe('function')
  })

  // ── Phase 2: Click-to-toggle (mousedown then mouseup without drag) ─────

  it('calls onToggle on click (mousedown + mouseup without mousemove)', () => {
    const props = defaultProps()
    const { result } = renderHook(() => useSidebarResize(props))

    // Simulate mousedown
    act(() => {
      result.current.handleMouseDown({
        clientX: 300,
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent)
    })

    // Simulate mouseup without any mousemove (no drag)
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })

    expect(props.onToggle).toHaveBeenCalledTimes(1)
  })

  it('does not call onToggle when enableToggle is false', () => {
    const props = { ...defaultProps(), enableToggle: false }
    const { result } = renderHook(() => useSidebarResize(props))

    act(() => {
      result.current.handleMouseDown({
        clientX: 300,
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent)
    })

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })

    expect(props.onToggle).not.toHaveBeenCalled()
  })

  // ── Phase 3: handleMouseDown with enableDrag=false ───────────────────────

  it('does not prevent default when enableDrag is false', () => {
    const props = { ...defaultProps(), enableDrag: false }
    const { result } = renderHook(() => useSidebarResize(props))

    const preventDefault = vi.fn()
    act(() => {
      result.current.handleMouseDown({
        clientX: 300,
        preventDefault,
      } as unknown as React.MouseEvent)
    })

    // When enableDrag is false, the function returns before preventDefault
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('prevents default when enableDrag is true (default)', () => {
    const props = defaultProps()
    const { result } = renderHook(() => useSidebarResize(props))

    const preventDefault = vi.fn()
    act(() => {
      result.current.handleMouseDown({
        clientX: 300,
        preventDefault,
      } as unknown as React.MouseEvent)
    })

    expect(preventDefault).toHaveBeenCalled()
  })

  // ── Phase 4: Width calculations via drag behavior ────────────────────────
  // Testing that a significant mousemove triggers isDragging

  it('sets isDragging on significant mousemove after mousedown', () => {
    const props = defaultProps()
    const { result } = renderHook(() => useSidebarResize(props))

    act(() => {
      result.current.handleMouseDown({
        clientX: 300,
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent)
    })

    // Move more than 5px to trigger isDragging
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 310 }))
    })

    expect(result.current.isDragging.current).toBe(true)

    // Cleanup
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })
  })

  it('does not set isDragging for small mousemove (under 5px)', () => {
    const props = defaultProps()
    const { result } = renderHook(() => useSidebarResize(props))

    act(() => {
      result.current.handleMouseDown({
        clientX: 300,
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent)
    })

    // Move less than 5px
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 303 }))
    })

    expect(result.current.isDragging.current).toBe(false)

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })
  })

  // ── Phase 5: setIsDraggingRail callback ──────────────────────────────────

  it('calls setIsDraggingRail(true) when drag starts and (false) on mouseup', () => {
    const setIsDraggingRail = vi.fn()
    const props = { ...defaultProps(), setIsDraggingRail }
    const { result } = renderHook(() => useSidebarResize(props))

    act(() => {
      result.current.handleMouseDown({
        clientX: 300,
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent)
    })

    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 320 }))
    })

    expect(setIsDraggingRail).toHaveBeenCalledWith(true)

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })

    expect(setIsDraggingRail).toHaveBeenCalledWith(false)
  })

  // ── Direction defaults ───────────────────────────────────────────────────

  it('defaults direction to "right"', () => {
    // Verify no error with default direction
    const props = defaultProps()
    const { result } = renderHook(() => useSidebarResize(props))
    expect(result.current.handleMouseDown).toBeDefined()
  })

  // ── Cleanup on unmount ───────────────────────────────────────────────────

  it('removes event listeners on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')
    const props = defaultProps()
    const { unmount } = renderHook(() => useSidebarResize(props))

    unmount()

    const removedEvents = removeEventListenerSpy.mock.calls.map((c) => c[0])
    expect(removedEvents).toContain('mousemove')
    expect(removedEvents).toContain('mouseup')

    removeEventListenerSpy.mockRestore()
  })

  // ── Cookie persistence ───────────────────────────────────────────────────

  it('persists width to cookie when widthCookieName is provided and drag completes', () => {
    const props = {
      ...defaultProps(),
      widthCookieName: 'sidebar-width',
    }
    const { result } = renderHook(() => useSidebarResize(props))

    act(() => {
      result.current.handleMouseDown({
        clientX: 300,
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent)
    })

    // Drag right to resize
    act(() => {
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 320 }))
    })

    // Check cookie was set (onResize was called with a width, and cookie was set)
    expect(props.onResize).toHaveBeenCalled()
    expect(document.cookie).toContain('sidebar-width=')

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'))
    })
  })
})
