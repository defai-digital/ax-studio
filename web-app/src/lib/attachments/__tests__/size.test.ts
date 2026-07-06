import { describe, expect, it } from 'vitest'
import { normalizeFileSize } from '../size'

describe('normalizeFileSize', () => {
  it('accepts non-negative safe integer numbers', () => {
    expect(normalizeFileSize(0)).toBe(0)
    expect(normalizeFileSize(2048)).toBe(2048)
  })

  it('accepts plain decimal integer strings', () => {
    expect(normalizeFileSize('0')).toBe(0)
    expect(normalizeFileSize(' 2048 ')).toBe(2048)
  })

  it('rejects coerced and non-decimal values', () => {
    for (const value of [
      true,
      false,
      [1024],
      '0x400',
      '1e6',
      '1024 bytes',
      '12.5',
      '',
      ' ',
      null,
      undefined,
    ]) {
      expect(normalizeFileSize(value)).toBeUndefined()
    }
  })

  it('rejects negative, fractional, infinite, and unsafe numbers', () => {
    for (const value of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(normalizeFileSize(value)).toBeUndefined()
    }
  })
})
