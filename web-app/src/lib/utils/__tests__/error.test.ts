import { describe, it, expect } from 'vitest'
import { extractErrorMessage, isContextSizeError, toError } from '../error'

describe('error utilities', () => {
  describe('isContextSizeError', () => {
    it('matches context-size errors case-insensitively', () => {
      expect(
        isContextSizeError('The request exceeds the available context size.')
      ).toBe(true)
    })

    it('ignores unrelated errors', () => {
      expect(isContextSizeError('model failed to load')).toBe(false)
    })
  })

  describe('extractErrorMessage', () => {
    it('reads common error shapes', () => {
      expect(extractErrorMessage(new Error('boom'))).toBe('boom')
      expect(extractErrorMessage({ reason: 'bad input' })).toBe('bad input')
      expect(extractErrorMessage({ detail: 'not found' })).toBe('not found')
      expect(extractErrorMessage({ code: 'MODEL_LOAD_FAILED' })).toBe(
        'MODEL_LOAD_FAILED'
      )
    })

    it('deduplicates array error messages', () => {
      expect(
        extractErrorMessage(
          [
            new Error('first'),
            { message: 'first' },
            { cause: { message: 'second' } },
          ],
          'Unknown error'
        )
      ).toBe('first; second')
    })

    it('falls back to redacted JSON for arbitrary objects', () => {
      expect(
        extractErrorMessage({
          code: '',
          fileName: 'internal.ts',
          value: 42,
        })
      ).toBe('{"code":"","value":42}')
    })
  })

  describe('toError', () => {
    it('returns Error instances unchanged', () => {
      const error = new Error('boom')
      expect(toError(error, 'fallback')).toBe(error)
    })

    it('wraps non-Error values with the fallback message', () => {
      expect(toError('boom', 'fallback').message).toBe('fallback')
      expect(toError({ message: 'boom' }, 'fallback').message).toBe('fallback')
    })
  })
})
