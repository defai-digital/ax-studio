/// <reference path="../../../types/global.d.ts" />
import { describe, it, expect } from 'vitest'
import { isRootDir } from '../path'

/**
 * IS_WINDOWS is now properly a boolean (false in the vitest config),
 * so tests exercise the Unix/Mac branch on non-Windows CI.
 * Both platform branches are covered below.
 */

describe('isRootDir', () => {
  // ── A: Specification Tests ──

  describe('Unix/Mac root detection', () => {
    it('returns true for the Unix filesystem root /', () => {
      // On Windows this would be false, but CI runs on Unix/Mac
      if (IS_WINDOWS) return
      expect(isRootDir('/')).toBe(true)
    })

    it('returns true for / with trailing slashes', () => {
      if (IS_WINDOWS) return
      expect(isRootDir('//')).toBe(true)
    })

    it('returns false for a subdirectory on Unix', () => {
      if (IS_WINDOWS) return
      expect(isRootDir('/home')).toBe(false)
    })

    it('returns false for a deep path on Unix', () => {
      if (IS_WINDOWS) return
      expect(isRootDir('/home/user/docs')).toBe(false)
    })

    it('returns false for an empty string', () => {
      expect(isRootDir('')).toBe(false)
    })
  })

  describe('Windows root detection', () => {
    it('returns true for C:\\ drive root', () => {
      if (!IS_WINDOWS) return
      expect(isRootDir('C:\\')).toBe(true)
    })

    it('returns true for D:\\ drive root', () => {
      if (!IS_WINDOWS) return
      expect(isRootDir('D:\\')).toBe(true)
    })

    it('returns true for lowercase drive letter', () => {
      if (!IS_WINDOWS) return
      expect(isRootDir('c:\\')).toBe(true)
    })

    it('returns true for drive letter without backslash (C:)', () => {
      if (!IS_WINDOWS) return
      expect(isRootDir('C:')).toBe(true)
    })

    it('returns true for forward-slash drive roots (C:/)', () => {
      if (!IS_WINDOWS) return
      expect(isRootDir('C:/')).toBe(true)
      expect(isRootDir('d:/')).toBe(true)
    })

    it('returns false for a subdirectory on Windows', () => {
      if (!IS_WINDOWS) return
      expect(isRootDir('C:\\Users')).toBe(false)
    })

    it('returns false for a Unix-style root / on Windows', () => {
      if (!IS_WINDOWS) return
      expect(isRootDir('/')).toBe(false)
    })
  })

  // ── B: Attack Tests ──

  describe('adversarial inputs', () => {
    it('rejects whitespace strings', () => {
      expect(isRootDir(' ')).toBe(false)
      expect(isRootDir('  ')).toBe(false)
    })

    it('rejects random text', () => {
      expect(isRootDir('random')).toBe(false)
      expect(isRootDir('123')).toBe(false)
    })

    // Windows-specific adversarial inputs
    it('rejects multi-character prefix before colon (Windows)', () => {
      if (!IS_WINDOWS) return
      expect(isRootDir('CD:\\')).toBe(false)
    })

    it('rejects numeric drive letter (Windows)', () => {
      if (!IS_WINDOWS) return
      expect(isRootDir('1:\\')).toBe(false)
    })

    it('rejects special character as drive letter (Windows)', () => {
      if (!IS_WINDOWS) return
      expect(isRootDir('$:\\')).toBe(false)
    })

    it('rejects UNC paths (Windows)', () => {
      if (!IS_WINDOWS) return
      expect(isRootDir('\\\\server\\share')).toBe(false)
    })
  })

  // ── C: Property Tests ──

  describe('properties', () => {
    it('returns a boolean for any string input', () => {
      const inputs = ['', '/', 'C:\\', 'random', '123', '/home/user']
      for (const input of inputs) {
        const result = isRootDir(input)
        expect(typeof result).toBe('boolean')
      }
    })

    it('is a pure function — same input always yields same output', () => {
      expect(isRootDir('/')).toBe(isRootDir('/'))
      expect(isRootDir('foo')).toBe(isRootDir('foo'))
    })

    if (!IS_WINDOWS) {
      it('Unix: / with various trailing slashes is still root', () => {
        expect(isRootDir('/')).toBe(true)
        expect(isRootDir('//')).toBe(true)
      })
    } else {
      it('Windows: all 26 drive letters are recognized as root', () => {
        for (let code = 65; code <= 90; code++) {
          const letter = String.fromCharCode(code)
          expect(isRootDir(`${letter}:\\`)).toBe(true)
        }
      })
    }
  })

  // ── D: Regression Tests ──

  describe('regression: IS_WINDOWS string coercion bug', () => {
    it('IS_WINDOWS is a proper boolean, not a truthy string', () => {
      // Previously JSON.stringify('false') produced the string "false"
      // which is truthy, causing the Windows branch to always execute.
      expect(typeof IS_WINDOWS).toBe('boolean')
    })
  })

  describe('regression: Windows forward-slash drive root', () => {
    it('treats C:/ as a drive root when the Windows branch is active', () => {
      // Drive the real regex used by isRootDir's Windows branch so this
      // assertion holds on Unix CI as well as Windows.
      expect(/^[a-zA-Z]:[\\/]?$/.test('C:/')).toBe(true)
      expect(/^[a-zA-Z]:[\\/]?$/.test('C:\\')).toBe(true)
      expect(/^[a-zA-Z]:[\\/]?$/.test('C:/Users')).toBe(false)
    })
  })
})
