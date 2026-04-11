import { safeStorageGetItem, safeStorageSetItem } from '@/lib/storage'

const KEY_LENGTH_BYTES = 32
const IV_LENGTH_BYTES = 12
const KEY_STORAGE_KEY = 'ax-studio-hf-token-key'
const ENCRYPTED_PREFIX = 'enc-v2.'

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

const isCryptoAvailable =
  typeof globalThis.crypto !== 'undefined' &&
  typeof globalThis.crypto.subtle === 'object'

let cachedKey: CryptoKey | null = null

const encodeBase64 = (value: Uint8Array): string => {
  let binary = ''
  value.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

const decodeBase64 = (value: string): Uint8Array => {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

const readStoredKey = (): Uint8Array | null => {
  const stored = safeStorageGetItem(localStorage, KEY_STORAGE_KEY, 'crypto')
  if (!stored) return null

  try {
    const bytes = decodeBase64(stored)
    if (bytes.length !== KEY_LENGTH_BYTES) return null
    return bytes
  } catch (error) {
    console.warn('Stored encryption key is invalid, regenerating:', error)
    return null
  }
}

const writeStoredKey = (key: Uint8Array) => {
  safeStorageSetItem(
    localStorage,
    KEY_STORAGE_KEY,
    encodeBase64(key),
    'crypto'
  )
}

const getEncryptionKey = async (): Promise<CryptoKey> => {
  if (cachedKey) return cachedKey

  if (!isCryptoAvailable) {
    throw new Error('Web Crypto API unavailable')
  }

  const storedKey = readStoredKey()
  const rawKey = storedKey ?? crypto.getRandomValues(new Uint8Array(KEY_LENGTH_BYTES))

  if (!storedKey) {
    writeStoredKey(rawKey)
  }

  cachedKey = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  )

  return cachedKey
}

const legacyEncrypt = (text: string): string => {
  // Keep backwards compatible decode path for previously stored values.
  // The previous XOR write path produced bytes that `decodeLegacy` could not
  // reverse, so new legacy writes must stay decodable by plain base64 decode.
  return encodeBase64(utf8Encoder.encode(text))
}

export async function encrypt(text: string): Promise<string> {
  if (!text) return text

  if (!isCryptoAvailable) {
    return legacyEncrypt(text)
  }

  try {
    const key = await getEncryptionKey()
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES))
    const plaintext = utf8Encoder.encode(text)
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
    )

    return `${ENCRYPTED_PREFIX}${encodeBase64(iv)}.${encodeBase64(encrypted)}`
  } catch (error) {
    console.warn('Falling back to legacy encryption format:', error)
    return legacyEncrypt(text)
  }
}

const isLegacyFormat = (value: string): boolean => value.includes('|')

const decodeLegacy = (value: string): string | null => {
  try {
    const [encoded] = value.split('|')
    if (!encoded) return null
    const bytes = decodeBase64(encoded)
    return utf8Decoder.decode(bytes)
  } catch {
    return null
  }
}

export async function decrypt(encryptedText: string): Promise<string> {
  if (!encryptedText) return encryptedText

  if (!isCryptoAvailable) {
    return encryptedText
  }

  if (isLegacyFormat(encryptedText) || !encryptedText.startsWith(ENCRYPTED_PREFIX)) {
    return decodeLegacy(encryptedText) ?? encryptedText
  }

  try {
    const payload = encryptedText.slice(ENCRYPTED_PREFIX.length)
    const [ivBase64, cipherBase64] = payload.split('.')
    if (!ivBase64 || !cipherBase64) return encryptedText

    const key = await getEncryptionKey()
    const iv = decodeBase64(ivBase64)
    const cipherText = decodeBase64(cipherBase64)

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      cipherText
    )

    return utf8Decoder.decode(plaintext)
  } catch (error) {
    console.warn('Failed to decrypt token, returning as-is:', error)
    // Intentionally return the raw input — recursing here would stack-overflow
    // on any corrupted `enc-v2.` value and brick the whole app.
    return encryptedText
  }
}
