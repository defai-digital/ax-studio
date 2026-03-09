import { describe, it, expect } from 'vitest'
import { ok, fail } from '../bootstrap-result'

describe('ok', () => {
  it('returns ok: true', () => {
    expect(ok()).toEqual({ ok: true })
  })
})

describe('fail', () => {
  it('returns ok: false with the provided error', () => {
    const err = new Error('boom')
    const result = fail(err)
    expect(result).toEqual({ ok: false, error: err })
  })

  it('wraps non-Error values', () => {
    const result = fail('string error')
    expect(result).toEqual({ ok: false, error: 'string error' })
  })
})
