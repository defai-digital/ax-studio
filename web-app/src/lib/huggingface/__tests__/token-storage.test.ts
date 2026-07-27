import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localStorageKey } from '@/constants/localStorage'

const secretMocks = vi.hoisted(() => ({
  getSecureSecret: vi.fn(),
  setSecureSecret: vi.fn(),
  deleteSecureSecret: vi.fn(),
}))

vi.mock('@/lib/storage/secure-secret', () => ({
  getSecureSecret: secretMocks.getSecureSecret,
  setSecureSecret: secretMocks.setSecureSecret,
  deleteSecureSecret: secretMocks.deleteSecureSecret,
  HUGGING_FACE_TOKEN_SECRET: 'hugging-face-token',
}))

import {
  clearStoredHuggingFaceToken,
  normalizeHuggingFaceToken,
  readStoredHuggingFaceToken,
  storeHuggingFaceToken,
  validateHuggingFaceToken,
} from '../token-storage'

describe('Hugging Face token storage', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    secretMocks.getSecureSecret.mockResolvedValue(null)
    secretMocks.setSecureSecret.mockResolvedValue(undefined)
    secretMocks.deleteSecureSecret.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes whitespace and an optional Bearer prefix', () => {
    expect(normalizeHuggingFaceToken('  Bearer hf_example  ')).toBe(
      'hf_example'
    )
  })

  it('rejects empty tokens and control characters', () => {
    expect(() => normalizeHuggingFaceToken('  ')).toThrow(
      'Enter a Hugging Face access token.'
    )
    expect(() => normalizeHuggingFaceToken('hf_bad\nvalue')).toThrow(
      'The Hugging Face access token is invalid.'
    )
  })

  it('reads an existing token from the secure store', async () => {
    secretMocks.getSecureSecret.mockResolvedValue('hf_saved')

    await expect(readStoredHuggingFaceToken()).resolves.toBe('hf_saved')
    expect(secretMocks.getSecureSecret).toHaveBeenCalledWith(
      'hugging-face-token'
    )
  })

  it('migrates a legacy General Settings token into secure storage', async () => {
    localStorage.setItem(
      localStorageKey.settingGeneral,
      JSON.stringify({
        state: {
          spellCheckChatInput: true,
          huggingfaceToken: 'hf_legacy',
        },
        version: 0,
      })
    )

    await expect(readStoredHuggingFaceToken()).resolves.toBe('hf_legacy')
    expect(secretMocks.setSecureSecret).toHaveBeenCalledWith(
      'hugging-face-token',
      'hf_legacy'
    )

    const migrated = JSON.parse(
      localStorage.getItem(localStorageKey.settingGeneral) ?? '{}'
    )
    expect(migrated.state.huggingfaceToken).toBeUndefined()
    expect(migrated.state.spellCheckChatInput).toBe(true)
  })

  it('stores and clears the normalized token securely', async () => {
    await expect(storeHuggingFaceToken(' Bearer hf_new ')).resolves.toBe(
      'hf_new'
    )
    expect(secretMocks.setSecureSecret).toHaveBeenCalledWith(
      'hugging-face-token',
      'hf_new'
    )

    await clearStoredHuggingFaceToken()
    expect(secretMocks.deleteSecureSecret).toHaveBeenCalledWith(
      'hugging-face-token'
    )
  })

  it('validates the token and returns the Hugging Face account', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          name: 'ax-user',
          fullname: 'AX User',
        }),
      })
    )

    await expect(validateHuggingFaceToken('hf_valid')).resolves.toEqual({
      name: 'ax-user',
      fullname: 'AX User',
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://huggingface.co/api/whoami-v2',
      expect.objectContaining({
        headers: { Authorization: 'Bearer hf_valid' },
      })
    )
  })

  it('reports rejected credentials without storing them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      })
    )

    await expect(validateHuggingFaceToken('hf_invalid')).rejects.toThrow(
      'This token is invalid or does not have Hub access.'
    )
  })
})
