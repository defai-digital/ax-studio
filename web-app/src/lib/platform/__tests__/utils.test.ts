import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// NOTE: vitest.config.ts defines IS_WEB_APP as JSON.stringify('false')
// which means it is the STRING 'false', not boolean false.
// This is important for isPlatformTauri's fallback path.

// We need to re-import fresh for each test group to reset module state
// since the module uses global defines at evaluation time.

describe('platform/utils', () => {
  let originalWindow: typeof globalThis.window

  beforeEach(() => {
    originalWindow = globalThis.window
  })

  afterEach(() => {
    // Restore window
    if (originalWindow) {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        writable: true,
        configurable: true,
      })
    }
  })

  describe('isPlatformTauri', () => {
    it('returns false when __TAURI_INTERNALS__ is not set on window', async () => {
      const { isPlatformTauri } = await import('../utils')
      // jsdom window exists but __TAURI_INTERNALS__ is not set
      expect(isPlatformTauri()).toBe(false)
    })

    it('returns true when __TAURI_INTERNALS__ is set on window', async () => {
      ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
      const { isPlatformTauri } = await import('../utils')

      expect(isPlatformTauri()).toBe(true)

      // Cleanup
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    })
  })

  describe('getCurrentPlatform', () => {
    it('returns "web" when no Tauri internals', async () => {
      const { getCurrentPlatform } = await import('../utils')
      const result = getCurrentPlatform()
      expect(result).toBe('web')
    })
  })

})
