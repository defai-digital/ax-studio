import { beforeEach, describe, expect, it } from 'vitest'
import { localStorageKey } from '@/constants/localStorage'
import {
  clearStoredAxBiMcpToken,
  readStoredAxBiMcpToken,
  storeAxBiMcpToken,
} from '../token-storage'

describe('AX BI encrypted token storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips a token without storing its plaintext', () => {
    storeAxBiMcpToken('sst_full-secret-token')

    const stored = localStorage.getItem(localStorageKey.axBiMcpToken)
    expect(stored).toBeTruthy()
    expect(stored).not.toContain('sst_full-secret-token')
    expect(readStoredAxBiMcpToken()).toBe('sst_full-secret-token')
  })

  it('uses randomized ciphertext for repeated writes', () => {
    storeAxBiMcpToken('sst_full-secret-token')
    const first = localStorage.getItem(localStorageKey.axBiMcpToken)
    storeAxBiMcpToken('sst_full-secret-token')
    const second = localStorage.getItem(localStorageKey.axBiMcpToken)

    expect(first).not.toBe(second)
  })

  it('removes malformed encrypted values', () => {
    localStorage.setItem(
      localStorageKey.axBiMcpToken,
      '{"version":1,"ciphertext":"bad"}'
    )

    expect(readStoredAxBiMcpToken()).toBeNull()
    expect(localStorage.getItem(localStorageKey.axBiMcpToken)).toBeNull()
  })

  it('clears the stored token', () => {
    storeAxBiMcpToken('sst_full-secret-token')
    clearStoredAxBiMcpToken()

    expect(readStoredAxBiMcpToken()).toBeNull()
  })
})
