/**
 * Simple encryption utilities for sensitive data storage
 * Uses a basic XOR encryption with key for synchronous operation
 */

const KEY = 'ax-studio-hf-token-v1'

/**
 * Simple synchronous encryption using XOR with key
 */
export function encrypt(text: string): string {
  if (!text) return text

  let result = ''
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length)
    result += String.fromCharCode(charCode)
  }

  // Add a simple integrity check
  const checksum = text.length.toString(36)
  result = checksum + '|' + btoa(result)

  return result
}

/**
 * Decrypts a string encrypted with the simple XOR method
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText) return encryptedText

  try {
    const [checksumStr, encoded] = encryptedText.split('|')
    if (!checksumStr || !encoded) return encryptedText

    const expectedLength = parseInt(checksumStr, 36)
    const encrypted = atob(encoded)

    let result = ''
    for (let i = 0; i < encrypted.length; i++) {
      const charCode = encrypted.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length)
      result += String.fromCharCode(charCode)
    }

    // Verify integrity
    if (result.length !== expectedLength) {
      console.warn('Integrity check failed, returning encrypted text')
      return encryptedText
    }

    return result
  } catch (error) {
    // If decryption fails (e.g., old unencrypted data), return as-is
    console.warn('Failed to decrypt data, returning as-is:', error)
    return encryptedText
  }
}
