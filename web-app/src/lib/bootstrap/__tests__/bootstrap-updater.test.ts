import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { bootstrapUpdater } from '../bootstrap-updater'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// UPDATE_CHECK_INTERVAL_MS is declared globally in types/global.d.ts
// Vitest needs a value for it
;(globalThis as any).UPDATE_CHECK_INTERVAL_MS = 60_000

describe('bootstrapUpdater', () => {
  it('does nothing in dev mode and returns a no-op cleanup', () => {
    const checkForUpdate = vi.fn()
    const cleanup = bootstrapUpdater({ checkForUpdate, isDev: true })
    expect(checkForUpdate).not.toHaveBeenCalled()
    cleanup()
    vi.advanceTimersByTime(200_000)
    expect(checkForUpdate).not.toHaveBeenCalled()
  })

  it('calls checkForUpdate immediately in non-dev mode', () => {
    const checkForUpdate = vi.fn()
    bootstrapUpdater({ checkForUpdate, isDev: false })
    expect(checkForUpdate).toHaveBeenCalledTimes(1)
  })

  it('calls checkForUpdate periodically after the interval', () => {
    const checkForUpdate = vi.fn()
    bootstrapUpdater({ checkForUpdate, isDev: false })
    vi.advanceTimersByTime(60_000)
    expect(checkForUpdate).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(60_000)
    expect(checkForUpdate).toHaveBeenCalledTimes(3)
  })

  it('stops periodic checks after cleanup is called', () => {
    const checkForUpdate = vi.fn()
    const cleanup = bootstrapUpdater({ checkForUpdate, isDev: false })
    cleanup()
    vi.advanceTimersByTime(200_000)
    // Only the initial call, no further periodic calls
    expect(checkForUpdate).toHaveBeenCalledTimes(1)
  })
})
