import { describe, it, expect } from 'vitest'
import { SecretString } from './index'

describe('SecretString', () => {
  describe('getValue', () => {
    it('returns the raw value passed to the constructor', () => {
      const secret = new SecretString('my-secret-key')
      expect(secret.getValue()).toBe('my-secret-key')
    })

    it('returns empty string when constructed with empty string', () => {
      const secret = new SecretString('')
      expect(secret.getValue()).toBe('')
    })
  })

  describe('hasValue', () => {
    it('returns true for non-empty value', () => {
      const secret = new SecretString('key')
      expect(secret.hasValue()).toBe(true)
    })

    it('returns false for empty string', () => {
      const secret = new SecretString('')
      expect(secret.hasValue()).toBe(false)
    })
  })

  describe('toString', () => {
    it('returns empty string when value is empty', () => {
      expect(new SecretString('').toString()).toBe('')
    })

    it('masks a single character as "*" ', () => {
      expect(new SecretString('a').toString()).toBe('*')
    })

    it('masks two characters as "**"', () => {
      expect(new SecretString('ab').toString()).toBe('**')
    })

    it('masks three characters showing first and last with one asterisk', () => {
      expect(new SecretString('abc').toString()).toBe('a*c')
    })

    it('masks longer strings with first char + asterisks + last char', () => {
      expect(new SecretString('abcd').toString()).toBe('a**d')
      expect(new SecretString('secret').toString()).toBe('s****t')
      expect(new SecretString('abcdefgh').toString()).toBe('a******h')
    })
  })

  describe('toJSON', () => {
    it('returns the same masked representation as toString', () => {
      const secret = new SecretString('supersecret')
      expect(secret.toJSON()).toBe(secret.toString())
    })

    it('returns masked output, never the raw value', () => {
      const secret = new SecretString('my-api-key')
      expect(secret.toJSON()).toBe('m********y')
      expect(secret.toJSON()).not.toBe('my-api-key')
    })
  })

  describe('toRaw', () => {
    it('returns the raw value for persistence', () => {
      const secret = new SecretString('raw-secret-value')
      expect(secret.toRaw()).toBe('raw-secret-value')
    })

    it('returns empty string when value is empty', () => {
      const secret = new SecretString('')
      expect(secret.toRaw()).toBe('')
    })
  })

  describe('static from', () => {
    it('creates a SecretString instance with the given value', () => {
      const secret = SecretString.from('test-key')
      expect(secret).toBeInstanceOf(SecretString)
      expect(secret.getValue()).toBe('test-key')
    })

    it('creates instance with empty string', () => {
      const secret = SecretString.from('')
      expect(secret).toBeInstanceOf(SecretString)
      expect(secret.hasValue()).toBe(false)
    })
  })

  describe('JSON.stringify integration', () => {
    it('produces masked output, not the raw secret', () => {
      const secret = new SecretString('topsecret')
      const json = JSON.stringify({ token: secret })
      expect(json).toContain('t*******t')
      expect(json).not.toContain('topsecret')
    })

    it('produces empty string for empty secret', () => {
      const secret = new SecretString('')
      const json = JSON.stringify({ token: secret })
      expect(json).toBe('{"token":""}')
    })
  })
})
