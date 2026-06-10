const KEY_LENGTH_BYTES = 32
const IV_LENGTH_BYTES = 12
const LEGACY_KEY_STORAGE_KEY = 'ax-studio-hf-token-key'
const ENCRYPTED_PREFIX = 'enc-v2.'

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder()

const isCryptoAvailable =
  typeof globalThis.crypto !== 'undefined' &&
  typeof globalThis.crypto.subtle === 'object'

let cachedKey: CryptoKey | null = null
let keyPromise: Promise<CryptoKey> | null = null

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

const getEncryptionKey = async (): Promise<CryptoKey> => {
  if (cachedKey) return cachedKey
  if (keyPromise) return keyPromise

  keyPromise = (async () => {
    if (!isCryptoAvailable) {
      throw new Error('Web Crypto API unavailable')
    }

    localStorage.removeItem(LEGACY_KEY_STORAGE_KEY)
    const rawKey = crypto.getRandomValues(new Uint8Array(KEY_LENGTH_BYTES))

    const key = await crypto.subtle.importKey(
      'raw',
      rawKey as unknown as BufferSource,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    )

    cachedKey = key
    return key
  })()

  return keyPromise
}

export async function encrypt(text: string): Promise<string> {
  if (!text) return text

  if (!isCryptoAvailable) {
    throw new Error('Web Crypto API unavailable — cannot store securely')
  }

  try {
    const key = await getEncryptionKey()
    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES))
    const plaintext = utf8Encoder.encode(text)
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as unknown as BufferSource },
        key,
        plaintext as unknown as BufferSource
      )
    )

    return `${ENCRYPTED_PREFIX}${encodeBase64(iv)}.${encodeBase64(encrypted)}`
  } catch (error) {
    console.error('Encryption failed — data will NOT be stored securely:', error)
    throw new Error('Encryption failed — cannot store securely')
  }
}

const isLegacyFormat = (value: string): boolean => value.includes('|')

export async function decrypt(encryptedText: string): Promise<string> {
  if (!encryptedText) return encryptedText

  if (!isCryptoAvailable) {
    return ''
  }

  if (isLegacyFormat(encryptedText) || !encryptedText.startsWith(ENCRYPTED_PREFIX)) {
    console.warn('Rejected unsupported legacy or plaintext secret format')
    return ''
  }

  try {
    const payload = encryptedText.slice(ENCRYPTED_PREFIX.length)
    const [ivBase64, cipherBase64] = payload.split('.')
    if (!ivBase64 || !cipherBase64) return encryptedText

    const key = await getEncryptionKey()
    const iv = decodeBase64(ivBase64)
    const cipherText = decodeBase64(cipherBase64)

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      cipherText as unknown as BufferSource
    )

    return utf8Decoder.decode(plaintext)
  } catch {
    return ''
  }
}
