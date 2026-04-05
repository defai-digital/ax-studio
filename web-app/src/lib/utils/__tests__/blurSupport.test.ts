import { describe, it, expect } from 'vitest'
import { supportsBlurEffects } from '../blurSupport'
import type { HardwareData } from '@/hooks/settings/useHardware'

/**
 * Helper to create minimal HardwareData for testing.
 * Only os_type and os_name are used by supportsBlurEffects.
 */
function makeHardwareData(
  os_type: string,
  os_name: string = ''
): HardwareData {
  return {
    cpu: { name: '', cores: 0 } as HardwareData['cpu'],
    gpus: [],
    os_type,
    os_name,
    total_memory: 0,
  }
}

describe('supportsBlurEffects', () => {
  // ── A: Specification Tests ──

  describe('null handling', () => {
    it('returns false when hardwareData is null', () => {
      expect(supportsBlurEffects(null)).toBe(false)
    })
  })

  describe('macOS', () => {
    it('returns true for macOS regardless of os_name', () => {
      expect(supportsBlurEffects(makeHardwareData('macos', 'macOS 14.0'))).toBe(
        true
      )
    })

    it('returns true for macOS with empty os_name', () => {
      expect(supportsBlurEffects(makeHardwareData('macos', ''))).toBe(true)
    })
  })

  describe('Windows', () => {
    it('returns true for Windows with build >= 17134', () => {
      expect(
        supportsBlurEffects(
          makeHardwareData('windows', 'Windows 10 Pro (build 22631)')
        )
      ).toBe(true)
    })

    it('returns true for Windows with exactly build 17134', () => {
      expect(
        supportsBlurEffects(
          makeHardwareData('windows', 'Windows 10 (build 17134)')
        )
      ).toBe(true)
    })

    it('returns false for Windows with build < 17134', () => {
      expect(
        supportsBlurEffects(
          makeHardwareData('windows', 'Windows 10 (build 10240)')
        )
      ).toBe(false)
    })

    it('returns true for Windows when build number is not present', () => {
      // DISCOVERED BUG: This defaults to true, which is optimistic.
      // Windows 7 or older could reach here and incorrectly get blur enabled.
      expect(
        supportsBlurEffects(makeHardwareData('windows', 'Windows 7'))
      ).toBe(true)
    })
  })

  describe('Linux', () => {
    it('returns true for Linux in browser environment', () => {
      // In jsdom, window is defined, so checkLinuxBlurSupport returns true
      expect(
        supportsBlurEffects(makeHardwareData('linux', 'Ubuntu 22.04'))
      ).toBe(true)
    })
  })

  describe('unknown OS', () => {
    it('returns false for unknown os_type', () => {
      expect(
        supportsBlurEffects(makeHardwareData('freebsd', 'FreeBSD 14'))
      ).toBe(false)
    })

    it('returns false for empty os_type', () => {
      expect(supportsBlurEffects(makeHardwareData('', ''))).toBe(false)
    })
  })

  // ── B: Attack Tests ──

  describe('adversarial inputs', () => {
    it('handles Windows os_name with build in unexpected format', () => {
      // "Build" with capital B — regex is case insensitive
      expect(
        supportsBlurEffects(
          makeHardwareData('windows', 'Windows 11 (Build 22621)')
        )
      ).toBe(true)
    })

    it('handles Windows os_name with multiple build numbers (takes first)', () => {
      expect(
        supportsBlurEffects(
          makeHardwareData(
            'windows',
            'Windows 10 (build 10240) updated (build 22000)'
          )
        )
      ).toBe(false)
    })

    it('handles Windows build number at boundary 17133 (one below threshold)', () => {
      expect(
        supportsBlurEffects(
          makeHardwareData('windows', 'Windows 10 (build 17133)')
        )
      ).toBe(false)
    })

    it('handles Windows build number at boundary 17135 (one above threshold)', () => {
      expect(
        supportsBlurEffects(
          makeHardwareData('windows', 'Windows 10 (build 17135)')
        )
      ).toBe(true)
    })

    it('returns true for Windows with non-numeric build string', () => {
      // "build abc" — regex won't match digits, falls through to default true
      expect(
        supportsBlurEffects(
          makeHardwareData('windows', 'Windows 10 (build abc)')
        )
      ).toBe(true)
    })
  })

  // ── C: Property Tests ──

  describe('properties', () => {
    it('always returns a boolean', () => {
      const inputs: Array<HardwareData | null> = [
        null,
        makeHardwareData('macos'),
        makeHardwareData('windows', 'Windows 10 (build 22000)'),
        makeHardwareData('linux'),
        makeHardwareData('unknown'),
      ]
      for (const input of inputs) {
        expect(typeof supportsBlurEffects(input)).toBe('boolean')
      }
    })

    it('is idempotent — calling twice with same input yields same result', () => {
      const data = makeHardwareData('windows', 'Windows 10 (build 22000)')
      expect(supportsBlurEffects(data)).toBe(supportsBlurEffects(data))
    })

    it('monotonicity — higher Windows build always implies support if lower build supports', () => {
      const lowBuild = makeHardwareData('windows', 'Windows 10 (build 17134)')
      const highBuild = makeHardwareData(
        'windows',
        'Windows 10 (build 22631)'
      )
      const lowResult = supportsBlurEffects(lowBuild)
      const highResult = supportsBlurEffects(highBuild)
      // If low build supports, high build must also support
      if (lowResult) {
        expect(highResult).toBe(true)
      }
    })
  })

  // ── D: Regression Tests ──
  // No past bug-fix commits found for this file beyond initial commit.
})
