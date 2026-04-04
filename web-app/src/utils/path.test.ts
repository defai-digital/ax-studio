import { describe, it, expect } from 'vitest'
import { isRootDir } from './path'

/**
 * IMPORTANT: In vitest.config.ts, IS_WINDOWS is defined as JSON.stringify('false')
 * which produces the string "false" — this is TRUTHY in JavaScript.
 * Therefore isRootDir always takes the Windows branch in tests.
 *
 * DISCOVERED BUG: IS_WINDOWS = '"false"' is truthy, so the Unix/Mac branch
 * is unreachable in the test environment. All tests below verify Windows behavior.
 */

describe('isRootDir', () => {
  // ── A: Specification Tests (Windows branch, since IS_WINDOWS is truthy) ──

  describe('Windows root detection (active branch in tests)', () => {
    it('returns true for C:\\ drive root', () => {
      expect(isRootDir('C:\\')).toBe(true)
    })

    it('returns true for D:\\ drive root', () => {
      expect(isRootDir('D:\\')).toBe(true)
    })

    it('returns true for lowercase drive letter', () => {
      expect(isRootDir('c:\\')).toBe(true)
    })

    it('returns true for drive letter without backslash (C:)', () => {
      // The regex /^[a-zA-Z]:\\?$/ makes the backslash optional
      expect(isRootDir('C:')).toBe(true)
    })

    it('returns false for a subdirectory on Windows', () => {
      expect(isRootDir('C:\\Users')).toBe(false)
    })

    it('returns false for a deep path on Windows', () => {
      expect(isRootDir('C:\\Users\\Documents\\folder')).toBe(false)
    })

    it('returns false for an empty string', () => {
      expect(isRootDir('')).toBe(false)
    })

    it('returns false for a Unix-style root /', () => {
      // In Windows branch, "/" does not match /^[a-zA-Z]:\\?$/
      expect(isRootDir('/')).toBe(false)
    })

    it('returns false for a forward-slash path', () => {
      expect(isRootDir('/home/user')).toBe(false)
    })
  })

  // ── B: Attack Tests ──

  describe('adversarial inputs (Windows branch)', () => {
    it('rejects multi-character prefix before colon', () => {
      expect(isRootDir('CD:\\')).toBe(false)
    })

    it('rejects numeric drive letter', () => {
      expect(isRootDir('1:\\')).toBe(false)
    })

    it('rejects special character as drive letter', () => {
      expect(isRootDir('$:\\')).toBe(false)
    })

    it('rejects drive root with trailing content', () => {
      expect(isRootDir('C:\\folder')).toBe(false)
    })

    it('rejects only a backslash', () => {
      expect(isRootDir('\\')).toBe(false)
    })

    it('rejects whitespace strings', () => {
      expect(isRootDir(' ')).toBe(false)
      expect(isRootDir('  ')).toBe(false)
    })

    it('rejects UNC paths', () => {
      expect(isRootDir('\\\\server\\share')).toBe(false)
    })
  })

  // ── C: Property Tests ──

  describe('properties', () => {
    it('is case-insensitive for drive letters A-Z', () => {
      for (const letter of ['A', 'z', 'M', 'x']) {
        expect(isRootDir(`${letter}:\\`)).toBe(
          isRootDir(`${letter.toLowerCase()}:\\`)
        )
      }
    })

    it('returns a boolean for any string input', () => {
      const inputs = ['', '/', 'C:\\', 'random', '123', 'C:\\Users']
      for (const input of inputs) {
        const result = isRootDir(input)
        expect(typeof result).toBe('boolean')
      }
    })

    it('is a pure function — same input always yields same output', () => {
      expect(isRootDir('C:\\')).toBe(isRootDir('C:\\'))
      expect(isRootDir('foo')).toBe(isRootDir('foo'))
    })

    it('all 26 uppercase drive letters are recognized as root', () => {
      for (let code = 65; code <= 90; code++) {
        const letter = String.fromCharCode(code)
        expect(isRootDir(`${letter}:\\`)).toBe(true)
      }
    })

    it('all 26 lowercase drive letters are recognized as root', () => {
      for (let code = 97; code <= 122; code++) {
        const letter = String.fromCharCode(code)
        expect(isRootDir(`${letter}:\\`)).toBe(true)
      }
    })
  })

  // ── D: Regression Tests ──
  // No past bug-fix commits found for this file beyond initial commit and rename.
})
