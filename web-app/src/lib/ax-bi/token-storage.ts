import { AES, enc } from 'crypto-js'
import { localStorageKey } from '@/constants/localStorage'
import {
  safeStorageGetItem,
  safeStorageRemoveItem,
  safeStorageSetItem,
} from '@/lib/storage/storage'

const STORAGE_CONTEXT = 'AX BI MCP token'
const TOKEN_ENCRYPTION_PASSPHRASE = 'ai.axstudio.app:ax-bi-mcp-token:v1'
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

export function storeAxBiMcpToken(token: string): void {
  const storage = getLocalStorage()
  if (!storage) throw new Error('Local storage is unavailable.')

  const payload: StoredAxBiToken = {
    version: ENCRYPTION_VERSION,
    ciphertext: AES.encrypt(token, TOKEN_ENCRYPTION_PASSPHRASE).toString(),
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

export function readStoredAxBiMcpToken(): string | null {
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
      TOKEN_ENCRYPTION_PASSPHRASE
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

export function clearStoredAxBiMcpToken(): void {
  const storage = getLocalStorage()
  if (!storage) return
  safeStorageRemoveItem(
    storage,
    localStorageKey.axBiMcpToken,
    STORAGE_CONTEXT
  )
}
