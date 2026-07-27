import { localStorageKey } from '@/constants/localStorage'
import {
  deleteSecureSecret,
  getSecureSecret,
  HUGGING_FACE_TOKEN_SECRET,
  setSecureSecret,
} from '@/lib/storage/secure-secret'
import {
  safeStorageGetItem,
  safeStorageRemoveItem,
  safeStorageSetItem,
} from '@/lib/storage/storage'

const STORAGE_CONTEXT = 'Hugging Face token migration'
const HUGGING_FACE_WHOAMI_URL = 'https://huggingface.co/api/whoami-v2'
const MAX_TOKEN_LENGTH = 4096

type HuggingFaceAccount = {
  name?: string
  fullname?: string
}

function getLocalStorage(): Storage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}

function parseLegacyGeneralSettings(raw: string): {
  payload: Record<string, unknown>
  state: Record<string, unknown>
} | null {
  try {
    const payload = JSON.parse(raw) as Record<string, unknown>
    if (!payload || typeof payload !== 'object') return null
    const state = payload.state
    if (!state || typeof state !== 'object' || Array.isArray(state)) return null
    return { payload, state: { ...(state as Record<string, unknown>) } }
  } catch {
    return null
  }
}

function readLegacyGeneralSettingsToken(): string | null {
  const storage = getLocalStorage()
  if (!storage) return null
  const raw = safeStorageGetItem(
    storage,
    localStorageKey.settingGeneral,
    STORAGE_CONTEXT
  )
  if (!raw) return null

  const parsed = parseLegacyGeneralSettings(raw)
  const token = parsed?.state.huggingfaceToken
  return typeof token === 'string' && token.trim() ? token : null
}

function clearLegacyGeneralSettingsToken(): void {
  const storage = getLocalStorage()
  if (!storage) return
  const key = localStorageKey.settingGeneral
  const raw = safeStorageGetItem(storage, key, STORAGE_CONTEXT)
  if (!raw) return

  const parsed = parseLegacyGeneralSettings(raw)
  if (!parsed || !('huggingfaceToken' in parsed.state)) return
  delete parsed.state.huggingfaceToken

  const nextValue = JSON.stringify({
    ...parsed.payload,
    state: parsed.state,
  })
  if (!safeStorageSetItem(storage, key, nextValue, STORAGE_CONTEXT)) {
    safeStorageRemoveItem(storage, key, STORAGE_CONTEXT)
  }
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127
  })
}

export function normalizeHuggingFaceToken(value: string): string {
  let token = value.trim()
  if (/^bearer\s+/i.test(token)) {
    token = token.replace(/^bearer\s+/i, '').trim()
  }
  if (!token) {
    throw new Error('Enter a Hugging Face access token.')
  }
  if (token.length > MAX_TOKEN_LENGTH || containsControlCharacter(token)) {
    throw new Error('The Hugging Face access token is invalid.')
  }
  return token
}

export async function readStoredHuggingFaceToken(): Promise<string | null> {
  const stored = await getSecureSecret(HUGGING_FACE_TOKEN_SECRET)
  if (stored?.trim()) {
    try {
      return normalizeHuggingFaceToken(stored)
    } catch {
      await deleteSecureSecret(HUGGING_FACE_TOKEN_SECRET)
    }
  }

  const legacyToken = readLegacyGeneralSettingsToken()
  if (!legacyToken) return null

  try {
    const normalized = normalizeHuggingFaceToken(legacyToken)
    await setSecureSecret(HUGGING_FACE_TOKEN_SECRET, normalized)
    clearLegacyGeneralSettingsToken()
    return normalized
  } catch {
    clearLegacyGeneralSettingsToken()
    return null
  }
}

export async function storeHuggingFaceToken(value: string): Promise<string> {
  const token = normalizeHuggingFaceToken(value)
  await setSecureSecret(HUGGING_FACE_TOKEN_SECRET, token)
  clearLegacyGeneralSettingsToken()
  return token
}

export async function clearStoredHuggingFaceToken(): Promise<void> {
  await deleteSecureSecret(HUGGING_FACE_TOKEN_SECRET)
  clearLegacyGeneralSettingsToken()
}

export async function validateHuggingFaceToken(
  value: string,
  signal?: AbortSignal
): Promise<HuggingFaceAccount> {
  const token = normalizeHuggingFaceToken(value)
  const response = await fetch(HUGGING_FACE_WHOAMI_URL, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  })

  if (response.status === 401 || response.status === 403) {
    throw new Error('This token is invalid or does not have Hub access.')
  }
  if (!response.ok) {
    throw new Error(
      `Hugging Face could not validate the token (HTTP ${response.status}).`
    )
  }

  const account = (await response.json()) as unknown
  if (!account || typeof account !== 'object') return {}
  const valueRecord = account as Record<string, unknown>
  return {
    name: typeof valueRecord.name === 'string' ? valueRecord.name : undefined,
    fullname:
      typeof valueRecord.fullname === 'string'
        ? valueRecord.fullname
        : undefined,
  }
}
