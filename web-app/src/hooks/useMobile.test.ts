import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

describe('useIsMobile', () => {
  let addEventListenerMock: ReturnType<typeof vi.fn>
  let removeEventListenerMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    addEventListenerMock = vi.fn()
    removeEventListenerMock = vi.fn()

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: addEventListenerMock,
        removeEventListener: removeEventListenerMock,
        dispatchEvent: vi.fn(),
      })),
    })
  })

  it('should return false when window width is >= 768', async () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      value: 1024,
    })

    const { useIsMobile } = await import('./use-mobile')
    const { result } = renderHook(() => useIsMobile())

    expect(result.current).toBe(false)
  })

  it('should return true when window width is < 768', async () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      value: 500,
    })

    const { useIsMobile } = await import('./use-mobile')
    const { result } = renderHook(() => useIsMobile())

    expect(result.current).toBe(true)
  })

  it('should register matchMedia listener with correct query', async () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      value: 1024,
    })

    const { useIsMobile } = await import('./use-mobile')
    renderHook(() => useIsMobile())

    expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 767px)')
  })

  it('should update when matchMedia change event fires', async () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      value: 1024,
    })

    const { useIsMobile } = await import('./use-mobile')
    const { result } = renderHook(() => useIsMobile())

    expect(result.current).toBe(false)

    // Simulate resize to mobile
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      value: 400,
    })

    const changeHandler = addEventListenerMock.mock.calls.find(
      (call: unknown[]) => call[0] === 'change'
    )?.[1]

    act(() => {
      changeHandler?.()
    })

    expect(result.current).toBe(true)
  })

  it('should return false for initial undefined state (coerced to boolean)', async () => {
    // Before the effect runs, isMobile is undefined, so !!undefined === false
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      value: 1024,
    })

    const { useIsMobile } = await import('./use-mobile')
    const { result } = renderHook(() => useIsMobile())

    // The hook returns !!isMobile which coerces undefined to false
    expect(result.current).toBe(false)
  })

  it('should remove event listener on unmount', async () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      value: 1024,
    })

    const { useIsMobile } = await import('./use-mobile')
    const { unmount } = renderHook(() => useIsMobile())

    unmount()

    expect(removeEventListenerMock).toHaveBeenCalledWith(
      'change',
      expect.any(Function)
    )
  })

  it('should detect exact breakpoint boundary at 768', async () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      value: 768,
    })

    const { useIsMobile } = await import('./use-mobile')
    const { result } = renderHook(() => useIsMobile())

    // 768 is NOT < 768, so not mobile
    expect(result.current).toBe(false)
  })

  it('should detect 767 as mobile', async () => {
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      value: 767,
    })

    const { useIsMobile } = await import('./use-mobile')
    const { result } = renderHook(() => useIsMobile())

    expect(result.current).toBe(true)
  })
})
