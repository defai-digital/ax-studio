import { AES, enc } from 'crypto-js'
import { localStorageKey } from '@/constants/localStorage'
import {
  deleteSecureSecret,
  getSecureSecret,
  setSecureSecret,
} from '@/lib/storage/secure-secret'
import {
  safeStorageGetItem,
  safeStorageRemoveItem,
  safeStorageSetItem,
} from '@/lib/storage/storage'
import { isPlatformTauri } from '@/lib/platform/utils'

const STORAGE_CONTEXT = 'AX BI MCP token'
/** OS keychain key (must match Rust secrets allow-list). */
export const AX_BI_MCP_TOKEN_SECRET = 'ax-bi-mcp-token'
/** Legacy AES passphrase — only used to migrate old localStorage values. */
const LEGACY_TOKEN_ENCRYPTION_PASSPHRASE = 'ai.axstudio.app:ax-bi-mcp-token:v1'
const ENCRYPTION_VERSION = 1

type StoredAxBiToken = {
  version: typeof ENCRYPTION_VERSION
  ciphertext: string
}

function getLocalStorage(): Storage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

function readLegacyEncryptedToken(): string | null {
  const storage = getLocalStorage()
  if (!storage) return null
  const raw = safeStorageGetItem(
    storage,
    localStorageKey.axBiMcpToken,
    STORAGE_CONTEXT
  )
  if (!raw) return null

  try {
    const payload = JSON.parse(raw) as Partial<StoredAxBiToken>
    if (
      payload.version !== ENCRYPTION_VERSION ||
      typeof payload.ciphertext !== 'string' ||
      !payload.ciphertext
    ) {
      throw new Error('Invalid encrypted token payload')
    }
    const token = AES.decrypt(
      payload.ciphertext,
      LEGACY_TOKEN_ENCRYPTION_PASSPHRASE
    ).toString(enc.Utf8)
    if (!token.trim()) throw new Error('Encrypted token could not be decrypted')
    return token
  } catch {
    safeStorageRemoveItem(
      storage,
      localStorageKey.axBiMcpToken,
      STORAGE_CONTEXT
    )
    return null
  }
}

function clearLegacyEncryptedToken(): void {
  const storage = getLocalStorage()
  if (!storage) return
  safeStorageRemoveItem(
    storage,
    localStorageKey.axBiMcpToken,
    STORAGE_CONTEXT
  )
}

/**
 * Persist the AX BI MCP token in the OS keychain when running under Tauri.
 * Falls back to legacy AES-obfuscated localStorage only outside Tauri (tests/web).
 */
export async function storeAxBiMcpToken(token: string): Promise<void> {
  if (isPlatformTauri()) {
    await setSecureSecret(AX_BI_MCP_TOKEN_SECRET, token)
    clearLegacyEncryptedToken()
    return
  }

  // Non-Tauri fallback (unit tests / pure web): keep obfuscated localStorage.
  const storage = getLocalStorage()
  if (!storage) throw new Error('Local storage is unavailable.')

  const payload: StoredAxBiToken = {
    version: ENCRYPTION_VERSION,
    ciphertext: AES.encrypt(token, LEGACY_TOKEN_ENCRYPTION_PASSPHRASE).toString(),
  }
  if (
    !safeStorageSetItem(
      storage,
      localStorageKey.axBiMcpToken,
      JSON.stringify(payload),
      STORAGE_CONTEXT
    )
  ) {
    throw new Error('Unable to save the AX BI token in local storage.')
  }
}

/**
 * Read the AX BI MCP token, migrating any legacy localStorage ciphertext into
 * the OS keychain on first successful read under Tauri.
 */
export async function readStoredAxBiMcpToken(): Promise<string | null> {
  if (isPlatformTauri()) {
    try {
      const fromKeychain = await getSecureSecret(AX_BI_MCP_TOKEN_SECRET)
      if (fromKeychain?.trim()) return fromKeychain
    } catch (error) {
      console.error('Unable to read the AX BI token from the OS keychain:', error)
    }

    const legacy = readLegacyEncryptedToken()
    if (legacy) {
      try {
        await setSecureSecret(AX_BI_MCP_TOKEN_SECRET, legacy)
        clearLegacyEncryptedToken()
      } catch (error) {
        console.error('Unable to migrate the AX BI token to the OS keychain:', error)
      }
      return legacy
    }
    return null
  }

  return readLegacyEncryptedToken()
}

export async function clearStoredAxBiMcpToken(): Promise<void> {
  if (isPlatformTauri()) {
    try {
      await deleteSecureSecret(AX_BI_MCP_TOKEN_SECRET)
    } catch (error) {
      console.error('Unable to delete the AX BI token from the OS keychain:', error)
    }
  }
  clearLegacyEncryptedToken()
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

/**
 * Normalize a user- or keychain-supplied AX BI token.
 * Strips optional leading `Bearer ` (case-insensitive) and trims whitespace.
 */
export function normalizeAxBiToken(token: string): string {
  let normalized = token.trim()
  if (/^bearer\s+/i.test(normalized)) {
    normalized = normalized.replace(/^bearer\s+/i, '').trim()
  }
  if (!normalized) {
    throw new Error('AX BI API key or JWT is required.')
  }
  if (containsControlCharacter(normalized)) {
    throw new Error('AX BI API key or JWT contains invalid characters.')
  }
  return normalized
}
