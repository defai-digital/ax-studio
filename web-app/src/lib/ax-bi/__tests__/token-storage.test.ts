import { beforeEach, describe, expect, it, vi } from 'vitest'
import { localStorageKey } from '@/constants/localStorage'

const secureSecretMocks = vi.hoisted(() => ({
  getSecureSecret: vi.fn(),
  hasSecureSecret: vi.fn(),
  setSecureSecret: vi.fn(),
  deleteSecureSecret: vi.fn(),
}))

const platformMocks = vi.hoisted(() => ({
  isPlatformTauri: vi.fn(() => false),
  isPlatformElectron: vi.fn(() => false),
}))

vi.mock('@/lib/storage/secure-secret', () => ({
  getSecureSecret: secureSecretMocks.getSecureSecret,
  hasSecureSecret: secureSecretMocks.hasSecureSecret,
  setSecureSecret: secureSecretMocks.setSecureSecret,
  deleteSecureSecret: secureSecretMocks.deleteSecureSecret,
  PROXY_PASSWORD_SECRET: 'proxy-password',
  AX_BI_MCP_TOKEN_SECRET: 'ax-bi-mcp-token',
}))

vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: platformMocks.isPlatformTauri,
  isPlatformElectron: platformMocks.isPlatformElectron,
}))

import {
  clearStoredAxBiMcpToken,
  hasStoredAxBiMcpToken,
  readStoredAxBiMcpToken,
  storeAxBiMcpToken,
} from '../token-storage'

describe('AX BI token storage', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    platformMocks.isPlatformTauri.mockReturnValue(false)
    platformMocks.isPlatformElectron.mockReturnValue(false)
  })

  describe('non-Tauri (legacy localStorage)', () => {
    it('round-trips a token without storing its plaintext', async () => {
      await storeAxBiMcpToken('sst_full-secret-token')

      const stored = localStorage.getItem(localStorageKey.axBiMcpToken)
      expect(stored).toBeTruthy()
      expect(stored).not.toContain('sst_full-secret-token')
      await expect(readStoredAxBiMcpToken()).resolves.toBe('sst_full-secret-token')
    })

    it('uses randomized ciphertext for repeated writes', async () => {
      await storeAxBiMcpToken('sst_full-secret-token')
      const first = localStorage.getItem(localStorageKey.axBiMcpToken)
      await storeAxBiMcpToken('sst_full-secret-token')
      const second = localStorage.getItem(localStorageKey.axBiMcpToken)

      expect(first).not.toBe(second)
    })

    it('removes malformed encrypted values', async () => {
      localStorage.setItem(
        localStorageKey.axBiMcpToken,
        '{"version":1,"ciphertext":"bad"}'
      )

      await expect(readStoredAxBiMcpToken()).resolves.toBeNull()
      expect(localStorage.getItem(localStorageKey.axBiMcpToken)).toBeNull()
    })

    it('clears the stored token', async () => {
      await storeAxBiMcpToken('sst_full-secret-token')
      await clearStoredAxBiMcpToken()

      await expect(readStoredAxBiMcpToken()).resolves.toBeNull()
    })
  })

  describe('Tauri (OS keychain)', () => {
    beforeEach(() => {
      platformMocks.isPlatformTauri.mockReturnValue(true)
      secureSecretMocks.getSecureSecret.mockResolvedValue(null)
      secureSecretMocks.setSecureSecret.mockResolvedValue(undefined)
      secureSecretMocks.deleteSecureSecret.mockResolvedValue(undefined)
    })

    it('stores tokens via the secure secret API', async () => {
      await storeAxBiMcpToken('sst_keychain-token')

      expect(secureSecretMocks.setSecureSecret).toHaveBeenCalledWith(
        'ax-bi-mcp-token',
        'sst_keychain-token'
      )
      expect(localStorage.getItem(localStorageKey.axBiMcpToken)).toBeNull()
    })

    it('reads from the keychain', async () => {
      secureSecretMocks.getSecureSecret.mockResolvedValue('sst_from-keychain')

      await expect(readStoredAxBiMcpToken()).resolves.toBe('sst_from-keychain')
      expect(secureSecretMocks.getSecureSecret).toHaveBeenCalledWith(
        'ax-bi-mcp-token'
      )
    })

    it('migrates legacy localStorage tokens into the keychain', async () => {
      platformMocks.isPlatformTauri.mockReturnValue(false)
      await storeAxBiMcpToken('sst_legacy-token')
      platformMocks.isPlatformTauri.mockReturnValue(true)
      secureSecretMocks.getSecureSecret.mockResolvedValue(null)

      await expect(readStoredAxBiMcpToken()).resolves.toBe('sst_legacy-token')
      expect(secureSecretMocks.setSecureSecret).toHaveBeenCalledWith(
        'ax-bi-mcp-token',
        'sst_legacy-token'
      )
      expect(localStorage.getItem(localStorageKey.axBiMcpToken)).toBeNull()
    })

    it('deletes from the keychain', async () => {
      await clearStoredAxBiMcpToken()
      expect(secureSecretMocks.deleteSecureSecret).toHaveBeenCalledWith(
        'ax-bi-mcp-token'
      )
    })
  })

  describe('Electron (main-process credential)', () => {
    beforeEach(() => {
      platformMocks.isPlatformTauri.mockReturnValue(true)
      platformMocks.isPlatformElectron.mockReturnValue(true)
      secureSecretMocks.hasSecureSecret.mockResolvedValue(true)
      secureSecretMocks.setSecureSecret.mockResolvedValue(undefined)
    })

    it('checks presence without reading the credential into the renderer', async () => {
      await expect(hasStoredAxBiMcpToken()).resolves.toBe(true)

      expect(secureSecretMocks.hasSecureSecret).toHaveBeenCalledWith(
        'ax-bi-mcp-token'
      )
      expect(secureSecretMocks.getSecureSecret).not.toHaveBeenCalled()
    })
  })
})
