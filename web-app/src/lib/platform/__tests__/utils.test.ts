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

  describe('getUnavailableFeatureMessage', () => {
    it('formats PascalCase feature name with spaces', async () => {
      const { getUnavailableFeatureMessage } = await import('../utils')
      const { PlatformFeature } = await import('../types')

      const msg = getUnavailableFeatureMessage(PlatformFeature.HARDWARE_MONITORING)
      expect(msg).toContain('Hardware')
      expect(msg).toContain('monitoring')
      // First letter is uppercased, rest lowercased by the regex
      expect(msg).toContain('Hardware')
    })

    it('includes the platform name in the message', async () => {
      const { getUnavailableFeatureMessage } = await import('../utils')
      const { PlatformFeature } = await import('../types')

      const msg = getUnavailableFeatureMessage(PlatformFeature.LOCAL_INFERENCE)
      expect(msg).toContain('platform')
    })

    it('converts camelCase feature value to human-readable format', async () => {
      const { getUnavailableFeatureMessage } = await import('../utils')
      const { PlatformFeature } = await import('../types')

      const msg = getUnavailableFeatureMessage(PlatformFeature.MODEL_HUB)
      // 'modelHub' → 'model Hub' → 'Model hub'
      expect(msg).toMatch(/model\s*Hub/i)
    })
  })

})
