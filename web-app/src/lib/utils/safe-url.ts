/**
 * Validate URLs before handing them to the OS opener.
 * Blocks non-http(s) schemes, credentials in the authority, and other
 * patterns that are commonly abused for phishing via XSS.
 */
function containsAsciiControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)
  })
}

export function assertSafeExternalUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) {
    throw new Error('URL is empty')
  }
  if (trimmed.length > 2048) {
    throw new Error('URL exceeds the maximum allowed length')
  }
  if (containsAsciiControlCharacter(trimmed)) {
    throw new Error('URL contains control characters')
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('URL is not absolute or is malformed')
  }

  const protocol = parsed.protocol.toLowerCase()
  if (protocol !== 'https:' && protocol !== 'http:') {
    throw new Error(`Blocked URL scheme: ${parsed.protocol}`)
  }

  if (parsed.username || parsed.password) {
    throw new Error('URLs with embedded credentials are not allowed')
  }

  if (!parsed.hostname) {
    throw new Error('URL is missing a hostname')
  }

  // Reject obvious script-injection host tricks
  if (parsed.hostname.includes('%') || parsed.hostname.includes('\\')) {
    throw new Error('URL hostname is invalid')
  }

  return parsed.toString()
}
