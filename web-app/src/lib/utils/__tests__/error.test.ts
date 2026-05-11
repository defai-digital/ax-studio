import { describe, it, expect } from 'vitest'
import { extractErrorMessage, OUT_OF_CONTEXT_SIZE } from '../error'

describe('error utilities', () => {
  describe('OUT_OF_CONTEXT_SIZE', () => {
    it('should have correct error message', () => {
      expect(OUT_OF_CONTEXT_SIZE).toBe('the request exceeds the available context size.')
    })

    it('should be a string', () => {
      expect(typeof OUT_OF_CONTEXT_SIZE).toBe('string')
    })
  })

  describe('extractErrorMessage', () => {
    it('reads common error shapes', () => {
      expect(extractErrorMessage(new Error('boom'))).toBe('boom')
      expect(extractErrorMessage({ reason: 'bad input' })).toBe('bad input')
      expect(extractErrorMessage({ detail: 'not found' })).toBe('not found')
      expect(extractErrorMessage({ code: 'MODEL_LOAD_FAILED' })).toBe('MODEL_LOAD_FAILED')
    })

    it('deduplicates array error messages', () => {
      expect(extractErrorMessage([
        new Error('first'),
        { message: 'first' },
        { cause: { message: 'second' } },
      ], 'Unknown error')).toBe('first; second')
    })

    it('falls back to redacted JSON for arbitrary objects', () => {
      expect(extractErrorMessage({
        code: '',
        fileName: 'internal.ts',
        value: 42,
      })).toBe('{"code":"","value":42}')
    })
  })
})
