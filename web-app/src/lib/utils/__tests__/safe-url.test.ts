import { describe, expect, it } from 'vitest'
import { assertSafeExternalUrl } from '../safe-url'

describe('assertSafeExternalUrl', () => {
  it('accepts https and http URLs', () => {
    expect(assertSafeExternalUrl('https://example.com/path')).toBe(
      'https://example.com/path'
    )
    expect(assertSafeExternalUrl('http://127.0.0.1:31421/mcp')).toBe(
      'http://127.0.0.1:31421/mcp'
    )
  })

  it('rejects non-http schemes', () => {
    expect(() => assertSafeExternalUrl('javascript:alert(1)')).toThrow(
      /Blocked URL scheme/
    )
    expect(() => assertSafeExternalUrl('file:///etc/passwd')).toThrow(
      /Blocked URL scheme/
    )
    expect(() => assertSafeExternalUrl('data:text/html,hi')).toThrow(
      /Blocked URL scheme/
    )
  })

  it('rejects embedded credentials', () => {
    expect(() =>
      assertSafeExternalUrl('https://user:pass@evil.example/')
    ).toThrow(/credentials/)
  })

  it.each(['https://example.com/\u0000path', 'https://example.com/\u001fpath'])(
    'rejects control characters in %s',
    (url) => {
      expect(() => assertSafeExternalUrl(url)).toThrow(/control characters/)
    }
  )

  it('rejects empty or relative values', () => {
    expect(() => assertSafeExternalUrl('')).toThrow(/empty/)
    expect(() => assertSafeExternalUrl('/relative')).toThrow(/malformed|absolute/)
  })
})
