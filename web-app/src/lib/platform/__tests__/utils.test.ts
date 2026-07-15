import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// NOTE: vitest.config.ts defines IS_WEB_APP as a boolean literal.
// The fallback path still accepts legacy string constants so older bundles
// remain safe if this utility is evaluated outside the browser runtime check.

// We need to re-import fresh for each test group to reset module state
// since the module uses global defines at evaluation time.

describe('platform/utils', () => {
  let originalWindow: typeof globalThis.window
  let originalPlatform: string
  let originalUserAgent: string
  let originalMaxTouchPoints: number

  beforeEach(() => {
    originalWindow = globalThis.window
    originalPlatform = navigator.platform
    originalUserAgent = navigator.userAgent
    originalMaxTouchPoints = navigator.maxTouchPoints
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
    Object.defineProperty(navigator, 'platform', {
      value: originalPlatform,
      configurable: true,
    })
    Object.defineProperty(navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true,
    })
    Object.defineProperty(navigator, 'maxTouchPoints', {
      value: originalMaxTouchPoints,
      configurable: true,
    })
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

  describe('isMlxSupported', () => {
    it('returns true on Apple platforms', async () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        configurable: true,
      })

      const { isMlxSupported } = await import('../utils')

      expect(isMlxSupported()).toBe(true)
    })

    it('returns false on non-Apple platforms', async () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        configurable: true,
      })

      const { isMlxSupported } = await import('../utils')

      expect(isMlxSupported()).toBe(false)
    })
  })

  describe('getInferenceProfile', () => {
    it('does not treat an iPad as a macOS MLX device', async () => {
      Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
      Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true })
      const { getInferenceProfile, isMlxSupported } = await import('../utils')
      expect(getInferenceProfile()).toBe('api-only')
      expect(isMlxSupported()).toBe(false)
    })

    it('uses API-only mode for Windows ARM64', async () => {
      Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true })
      Object.defineProperty(navigator, 'userAgent', { value: 'Windows NT 10.0; ARM64', configurable: true })
      const { getInferenceProfile } = await import('../utils')
      expect(getInferenceProfile()).toBe('api-only')
    })

    it('keeps Windows x64 on the local llama.cpp profile', async () => {
      Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true })
      Object.defineProperty(navigator, 'userAgent', { value: 'Windows NT 10.0; Win64; x64', configurable: true })
      const { getInferenceProfile } = await import('../utils')
      expect(getInferenceProfile()).toBe('windows-x64-local')
    })
  })

})
