import { describe, it, expect } from 'vitest'
import {
  handleSubAgentError,
  isRateLimitError,
  isTimeoutError,
  isToolNotSupportedError,
  isAbortError,
} from './error-handling'

describe('error type detection', () => {
  describe('isRateLimitError', () => {
    it('detects rate limit from error message', () => {
      expect(isRateLimitError(new Error('Rate limit exceeded'))).toBe(true)
    })

    it('detects 429 status code', () => {
      expect(isRateLimitError({ status: 429 })).toBe(true)
    })

    it('detects 429 in message', () => {
      expect(isRateLimitError(new Error('Error 429: Too many requests'))).toBe(
        true
      )
    })

    it('returns false for other errors', () => {
      expect(isRateLimitError(new Error('Something else'))).toBe(false)
    })
  })

  describe('isTimeoutError', () => {
    it('detects timeout in message', () => {
      expect(isTimeoutError(new Error('Request timed out'))).toBe(true)
    })

    it('detects timeout keyword', () => {
      expect(isTimeoutError(new Error('Operation timeout'))).toBe(true)
    })

    it('returns false for other errors', () => {
      expect(isTimeoutError(new Error('Something else'))).toBe(false)
    })
  })

  describe('isToolNotSupportedError', () => {
    it('detects tool unsupported', () => {
      expect(
        isToolNotSupportedError(
          new Error('This model does not support tool calling')
        )
      ).toBe(true)
    })

    it('returns false for other errors', () => {
      expect(isToolNotSupportedError(new Error('Something else'))).toBe(false)
    })
  })

  describe('isAbortError', () => {
    it('detects AbortError by name', () => {
      const error = new Error('Aborted')
      error.name = 'AbortError'
      expect(isAbortError(error)).toBe(true)
    })

    it('detects AbortError from object', () => {
      expect(isAbortError({ name: 'AbortError' })).toBe(true)
    })

    it('returns false for other errors', () => {
      expect(isAbortError(new Error('Something else'))).toBe(false)
    })
  })
})

describe('handleSubAgentError', () => {
  const agent = {
    name: 'Researcher',
    model_override_id: 'gpt-4o',
    timeout: { total_ms: 120000 },
  }

  it('re-throws abort errors', () => {
    const error = new Error('Aborted')
    error.name = 'AbortError'
    expect(() => handleSubAgentError(agent, error)).toThrow()
  })

  it('returns rate limit error XML', () => {
    const result = handleSubAgentError(
      agent,
      new Error('Rate limit exceeded')
    )
    expect(result.error).toContain('type="rate_limit"')
    expect(result.error).toContain('Researcher')
  })

  it('returns timeout error XML', () => {
    const result = handleSubAgentError(
      agent,
      new Error('Request timed out')
    )
    expect(result.error).toContain('type="timeout"')
    expect(result.error).toContain('120000ms')
  })

  it('returns tool unsupported error XML', () => {
    const result = handleSubAgentError(
      agent,
      new Error('This model does not support tool calling')
    )
    expect(result.error).toContain('type="tool_unsupported"')
    expect(result.error).toContain('gpt-4o')
  })

  it('returns generic error XML for unknown errors', () => {
    const result = handleSubAgentError(
      agent,
      new Error('Something unexpected')
    )
    expect(result.error).toContain('type="unknown"')
    expect(result.error).toContain('Something unexpected')
  })
})
