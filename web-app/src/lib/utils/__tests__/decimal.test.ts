import { describe, expect, it } from 'vitest'
import { isPlainDecimalString, parsePlainDecimalNumber } from '../decimal'

describe('isPlainDecimalString', () => {
  it('accepts plain decimal values', () => {
    expect(isPlainDecimalString('0')).toBe(true)
    expect(isPlainDecimalString('-12')).toBe(true)
    expect(isPlainDecimalString('+3.5')).toBe(true)
    expect(isPlainDecimalString('.25')).toBe(true)
  })

  it('rejects non-decimal and partial numeric values', () => {
    expect(isPlainDecimalString('')).toBe(false)
    expect(isPlainDecimalString('0x10')).toBe(false)
    expect(isPlainDecimalString('1e2')).toBe(false)
    expect(isPlainDecimalString('6abc')).toBe(false)
    expect(isPlainDecimalString('Infinity')).toBe(false)
  })

  it('only allows trailing decimal points when requested', () => {
    expect(isPlainDecimalString('6.')).toBe(false)
    expect(isPlainDecimalString('6.', { allowTrailingDot: true })).toBe(true)
    expect(isPlainDecimalString('.', { allowTrailingDot: true })).toBe(false)
  })
})

describe('parsePlainDecimalNumber', () => {
  it('parses finite plain decimal values', () => {
    expect(parsePlainDecimalNumber(' 12.5 ')).toBe(12.5)
    expect(parsePlainDecimalNumber(-3)).toBe(-3)
  })

  it('returns null for unsupported numeric formats', () => {
    expect(parsePlainDecimalNumber('1e2')).toBeNull()
    expect(parsePlainDecimalNumber('0x10')).toBeNull()
    expect(parsePlainDecimalNumber(Infinity)).toBeNull()
    expect(parsePlainDecimalNumber(null)).toBeNull()
  })
})
