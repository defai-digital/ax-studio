import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ExaRateLimitError,
  getErrorMessage,
  isExaRateLimitMessage,
  isExaRateLimitError,
  normalizeUrl,
  resetExaGate,
} from '../research-search'

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('getErrorMessage', () => {
  it('should return message from Error instances', () => {
    const err = new Error('something went wrong')
    expect(getErrorMessage(err)).toBe('something went wrong')
  })

  it('should stringify non-Error values', () => {
    expect(getErrorMessage('string error')).toBe('string error')
    expect(getErrorMessage(42)).toBe('42')
    expect(getErrorMessage(null)).toBe('null')
    expect(getErrorMessage(undefined)).toBe('undefined')
  })

  it('should handle objects', () => {
    expect(getErrorMessage({ code: 500 })).toBe('[object Object]')
  })
})

describe('isExaRateLimitMessage', () => {
  it('should detect 429 status code', () => {
    expect(isExaRateLimitMessage('HTTP 429 Too Many Requests')).toBe(true)
  })

  it('should detect "too many requests"', () => {
    expect(isExaRateLimitMessage('Too many requests, slow down')).toBe(true)
  })

  it('should detect "rate" and "limit" together', () => {
    expect(isExaRateLimitMessage('Rate limit exceeded')).toBe(true)
  })

  it('should be case insensitive', () => {
    expect(isExaRateLimitMessage('RATE LIMIT EXCEEDED')).toBe(true)
    expect(isExaRateLimitMessage('Too Many Requests')).toBe(true)
  })

  it('should return false for unrelated messages', () => {
    expect(isExaRateLimitMessage('Connection refused')).toBe(false)
    expect(isExaRateLimitMessage('Internal server error')).toBe(false)
  })

  it('should return false for empty string', () => {
    expect(isExaRateLimitMessage('')).toBe(false)
  })

  it('should not match "rate" alone without "limit"', () => {
    expect(isExaRateLimitMessage('data rate is high')).toBe(false)
  })

  it('should not match "limit" alone without "rate"', () => {
    expect(isExaRateLimitMessage('limit reached for storage')).toBe(false)
  })
})

describe('isExaRateLimitError', () => {
  it('should detect ExaRateLimitError by name', () => {
    const err = new ExaRateLimitError()
    expect(isExaRateLimitError(err)).toBe(true)
  })

  it('should detect rate limit from error message', () => {
    const err = new Error('429 Too Many Requests')
    expect(isExaRateLimitError(err)).toBe(true)
  })

  it('should return false for unrelated errors', () => {
    const err = new Error('Network timeout')
    expect(isExaRateLimitError(err)).toBe(false)
  })

  it('should handle non-Error values', () => {
    expect(isExaRateLimitError('429')).toBe(true)
    expect(isExaRateLimitError('hello')).toBe(false)
    expect(isExaRateLimitError(null)).toBe(false)
  })
})

describe('ExaRateLimitError', () => {
  it('should have correct name', () => {
    const err = new ExaRateLimitError()
    expect(err.name).toBe('ExaRateLimitError')
  })

  it('should have default message', () => {
    const err = new ExaRateLimitError()
    expect(err.message).toBe('Exa rate limit exceeded')
  })

  it('should accept custom message', () => {
    const err = new ExaRateLimitError('Custom rate limit')
    expect(err.message).toBe('Custom rate limit')
  })

  it('should be an instance of Error', () => {
    const err = new ExaRateLimitError()
    expect(err).toBeInstanceOf(Error)
  })
})

describe('normalizeUrl', () => {
  it('should normalize a simple URL', () => {
    expect(normalizeUrl('https://example.com/path')).toBe('example.com/path')
  })

  it('should remove trailing slash', () => {
    expect(normalizeUrl('https://example.com/')).toBe('example.com')
  })

  it('should lowercase the result', () => {
    expect(normalizeUrl('https://Example.COM/Path')).toBe('example.com/path')
  })

  it('should strip protocol and query params', () => {
    const result = normalizeUrl('https://example.com/path?q=test')
    expect(result).toBe('example.com/path')
  })

  it('should handle invalid URLs by lowercasing', () => {
    expect(normalizeUrl('not-a-url')).toBe('not-a-url')
  })

  it('should handle empty string', () => {
    expect(normalizeUrl('')).toBe('')
  })

  it('should strip port from URL', () => {
    const result = normalizeUrl('http://localhost:3000/api')
    expect(result).toBe('localhost/api')
  })
})

describe('resetExaGate', () => {
  it('should not throw', () => {
    expect(() => resetExaGate()).not.toThrow()
  })
})
