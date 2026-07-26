// Validation policy for the privileged download IPC boundary.
// Node port of src-tauri/src/core/downloads/policy.rs plus the
// ax_studio_utils network helpers it relies on (is_private_ip / is_internal_url
// from src-tauri/utils/src/network.rs).

export const MAX_DOWNLOAD_ITEMS = 256
const MAX_DOWNLOAD_TASK_ID_LEN = 128
const MAX_DOWNLOAD_URL_LEN = 16 * 1024
const MAX_DOWNLOAD_PATH_LEN = 4 * 1024
export const MAX_DOWNLOAD_HEADERS = 64
export const MAX_DOWNLOAD_HEADER_BYTES = 64 * 1024
const MAX_PROXY_URL_LEN = 4 * 1024
const MAX_PROXY_CREDENTIAL_LEN = 4 * 1024
const MAX_NO_PROXY_ENTRIES = 128

const MANAGED_REQUEST_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'proxy-authorization',
  'range',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

export interface ProxyConfig {
  url: string
  username?: string
  password?: string
  no_proxy?: string[]
  ignore_ssl?: boolean
}

export interface DownloadItem {
  url: string
  save_path: string
  proxy?: ProxyConfig
  sha256?: string
  size?: number
  model_id?: string
}

/**
 * Test-only escape hatch: the smoke suite serves fixtures from 127.0.0.1,
 * which the production policy correctly rejects as an internal address.
 * Mirrors nothing in Rust — gated behind an env var that is only set by
 * main.ts in --smoke mode.
 */
export function privateDownloadsAllowed(): boolean {
  return process.env.AX_STUDIO_DOWNLOAD_ALLOW_PRIVATE === '1'
}

export function errToString(error: unknown): string {
  return `Error: ${error instanceof Error ? error.message : String(error)}`
}

export function redactUrlForLog(rawUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return '<invalid URL>'
  }
  const hadSensitiveParts =
    parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== ''
  parsed.username = ''
  parsed.password = ''
  parsed.search = ''
  parsed.hash = ''
  const clean = parsed.toString()
  return hadSensitiveParts ? `${clean}?[REDACTED]` : clean
}

// ─── IP classification (utils/src/network.rs) ────────────────────────────────

function isPrivateIpv4(octets: number[]): boolean {
  const [first, second, third] = octets
  return (
    first === 127 || // loopback
    first === 10 || // private
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) || // link-local
    first === 0 || // "this network" (RFC 1122)
    (first === 100 && second >= 64 && second <= 127) || // shared address space (RFC 6598)
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224 // multicast / reserved / broadcast
  )
}

/** Parse an IPv6 address into its 16 bytes, or null when invalid. */
function parseIpv6Bytes(ip: string): number[] | null {
  let input = ip.toLowerCase()
  // Embedded IPv4 tail ("::ffff:192.168.0.1" / "::192.168.0.1").
  const v4Match = input.match(/(\d+\.\d+\.\d+\.\d+)$/)
  let v4Bytes: number[] | null = null
  if (v4Match) {
    v4Bytes = v4Match[1].split('.').map(Number)
    if (v4Bytes.some((o) => o > 255)) return null
    input = input.slice(0, input.length - v4Match[1].length)
    if (input.endsWith(':') && !input.endsWith('::')) input = input.slice(0, -1)
  }
  const halves = input.split('::')
  if (halves.length > 2) return null
  const parseGroups = (s: string): number[] =>
    s === ''
      ? []
      : s.split(':').map((g) => {
          const n = parseInt(g, 16)
          return Number.isNaN(n) || n > 0xffff || g.length > 4 || g.length === 0 ? -1 : n
        })
  const head = parseGroups(halves[0])
  const tail = halves.length === 2 ? parseGroups(halves[1]) : []
  if (head.includes(-1) || tail.includes(-1)) return null
  const groupsCount = head.length + tail.length + (v4Bytes ? 2 : 0)
  if (halves.length === 1 && groupsCount !== 8) return null
  if (halves.length === 2 && groupsCount > 7) return null
  const missing = 8 - groupsCount
  const groups = [...head, ...Array<number>(Math.max(missing, 0)).fill(0), ...tail]
  const bytes: number[] = []
  for (const g of groups) bytes.push(g >> 8, g & 0xff)
  if (v4Bytes) bytes.push(...v4Bytes)
  return bytes.length === 16 ? bytes : null
}

function isPrivateIpv6Bytes(bytes: number[]): boolean {
  // Loopback ::1 and unspecified ::.
  if (bytes.slice(0, 15).every((b) => b === 0) && (bytes[15] === 1 || bytes[15] === 0)) return true
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) — mirrors
  // Rust's Ipv6Addr::to_ipv4, which also maps ::1 to 0.0.0.1 (handled above).
  if (bytes.slice(0, 10).every((b) => b === 0)) {
    if (bytes[10] === 0xff && bytes[11] === 0xff) {
      return isPrivateIpv4(bytes.slice(12))
    }
    if (bytes[10] === 0 && bytes[11] === 0 && bytes.slice(12, 15).some((b) => b !== 0)) {
      return isPrivateIpv4(bytes.slice(12))
    }
  }
  return (
    ((bytes[0] & 0xfe) === 0xfe && (bytes[1] & 0xc0) === 0x80) || // link-local fe80::/10 (mirrors Rust bitmask exactly)
    (bytes[0] & 0xfe) === 0xfc || // unique-local fc00::/7
    (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) || // deprecated site-local fec0::/10
    bytes[0] === 0xff || // multicast
    (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) // documentation 2001:db8::/32
  )
}

export function isPrivateIp(ip: string): boolean {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) {
    const octets = v4.slice(1).map(Number)
    if (octets.some((o) => o > 255)) return false
    return isPrivateIpv4(octets)
  }
  const bytes = parseIpv6Bytes(ip)
  if (bytes) return isPrivateIpv6Bytes(bytes)
  return false
}

export function isInternalUrl(rawUrl: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return true
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true
  const host = parsed.hostname
  if (host === '') return true
  if (host.startsWith('[') || host.includes(':')) {
    return isPrivateIp(host.replace(/^\[|\]$/g, ''))
  }
  if (/^[\d.]+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) {
    // WHATWG URL already normalized numeric IPv4 forms into dotted decimal.
    return isPrivateIp(host)
  }
  const domain = host.replace(/\.+$/, '').toLowerCase()
  return (
    domain === 'localhost' ||
    domain.endsWith('.localhost') ||
    domain === 'local' ||
    domain.endsWith('.local') ||
    domain === 'internal' ||
    domain.endsWith('.internal')
  )
}

// ─── Request validation (policy.rs) ─────────────────────────────────────────

export function validateDownloadUrl(rawUrl: string): URL {
  if (rawUrl.length === 0 || rawUrl.length > MAX_DOWNLOAD_URL_LEN) {
    throw new Error(`Download URL must contain between 1 and ${MAX_DOWNLOAD_URL_LEN} bytes`)
  }
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('Download URL is invalid')
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new Error('Download URL must not contain embedded credentials')
  }
  // The scheme check is never relaxed; the env-flag escape hatch below only
  // covers private/internal addresses (smoke fixture on 127.0.0.1).
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Download URL '${redactUrlForLog(rawUrl)}' points to an internal/private or reserved address`
    )
  }
  if (!privateDownloadsAllowed() && isInternalUrl(rawUrl)) {
    throw new Error(
      `Download URL '${redactUrlForLog(rawUrl)}' points to an internal/private or reserved address`
    )
  }
  return parsed
}

export function validateDownloadTaskId(taskId: string): void {
  if (taskId.length === 0 || taskId.length > MAX_DOWNLOAD_TASK_ID_LEN) {
    throw new Error(
      `Download task ID must contain between 1 and ${MAX_DOWNLOAD_TASK_ID_LEN} characters`
    )
  }
  if (!/^[A-Za-z0-9_-]+$/.test(taskId)) {
    throw new Error("Download task ID may contain only ASCII letters, digits, '-' and '_'")
  }
}

function validateDownloadItem(item: DownloadItem): void {
  const parsedUrl = validateDownloadUrl(item.url)

  if (item.save_path.trim().length === 0 || item.save_path.length > MAX_DOWNLOAD_PATH_LEN) {
    throw new Error(`Download save path must contain between 1 and ${MAX_DOWNLOAD_PATH_LEN} bytes`)
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(item.save_path)) {
    throw new Error('Download save path must not contain control characters')
  }

  if (item.sha256 !== undefined) {
    if (!/^[0-9a-fA-F]{64}$/.test(item.sha256)) {
      throw new Error('Download SHA-256 must contain exactly 64 hexadecimal characters')
    }
  }

  if (parsedUrl.protocol === 'http:' && item.sha256 === undefined) {
    throw new Error('SHA-256 verification is required for downloads over insecure HTTP')
  }

  if (item.model_id !== undefined) {
    // eslint-disable-next-line no-control-regex
    if (item.model_id.length > 512 || /[\u0000-\u001F\u007F]/.test(item.model_id)) {
      throw new Error('Download model ID is invalid')
    }
  }

  if (item.proxy !== undefined) {
    validateProxyConfig(item.proxy)
    if (item.proxy.ignore_ssl === true && item.sha256 === undefined) {
      throw new Error(
        'SHA-256 verification is required when TLS certificate validation is disabled'
      )
    }
  }
}

export function validateDownloadRequest(
  items: DownloadItem[],
  taskId: string,
  headers: Record<string, string>
): void {
  validateDownloadTaskId(taskId)
  if (items.length === 0) {
    throw new Error('Download request must include at least one file')
  }
  if (items.length > MAX_DOWNLOAD_ITEMS) {
    throw new Error(`Download request exceeds the ${MAX_DOWNLOAD_ITEMS}-file batch limit`)
  }
  for (const item of items) validateDownloadItem(item)
  convertHeaders(headers)
}

export function validateProxyConfig(config: ProxyConfig): void {
  if (config.url.length === 0 || config.url.length > MAX_PROXY_URL_LEN) {
    throw new Error(`Proxy URL must contain between 1 and ${MAX_PROXY_URL_LEN} bytes`)
  }
  let url: URL
  try {
    url = new URL(config.url)
  } catch (error) {
    throw new Error(`Invalid proxy URL: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (url.hostname === '') {
    throw new Error('Proxy URL must include a host')
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('Proxy URL must not contain embedded credentials; use username/password fields')
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error('Proxy URL must contain only a scheme, host, and optional port')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported proxy scheme: ${url.protocol.replace(/:$/, '')}`)
  }
  if (
    (config.username !== undefined && config.username.length > MAX_PROXY_CREDENTIAL_LEN) ||
    (config.password !== undefined && config.password.length > MAX_PROXY_CREDENTIAL_LEN)
  ) {
    throw new Error(`Proxy credentials exceed the ${MAX_PROXY_CREDENTIAL_LEN}-byte limit`)
  }
  if (config.username !== undefined && config.password === undefined) {
    throw new Error('Username provided without password')
  }
  if (config.password !== undefined && config.username === undefined) {
    throw new Error('Password provided without username')
  }

  if (config.no_proxy !== undefined) {
    if (config.no_proxy.length > MAX_NO_PROXY_ENTRIES) {
      throw new Error(`no_proxy exceeds the ${MAX_NO_PROXY_ENTRIES}-entry limit`)
    }
    for (const entry of config.no_proxy) {
      if (entry.length === 0) throw new Error('Empty no_proxy entry')
      // eslint-disable-next-line no-control-regex
      if (entry.length > 255 || /[\u0000-\u001F\u007F]/.test(entry)) {
        throw new Error('Invalid no_proxy entry')
      }
      if (entry.startsWith('*.') && entry.length < 3) {
        throw new Error(`Invalid wildcard pattern: ${entry}`)
      }
      if (
        entry.includes('*') &&
        entry !== '*' &&
        !entry.startsWith('*.') &&
        !(
          entry.endsWith('.*') &&
          /^[\d.]+$/.test(entry.slice(0, -1))
        )
      ) {
        throw new Error(`Invalid wildcard pattern: ${entry}`)
      }
    }
  }
}

export function shouldBypassProxy(rawUrl: string, noProxy: string[]): boolean {
  if (noProxy.length === 0) return false
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  if (parsed.hostname === '') return false
  const host = parsed.hostname.replace(/\.+$/, '').toLowerCase()

  for (const rawEntry of noProxy) {
    const entry = rawEntry.replace(/\.+$/, '').toLowerCase()
    if (entry === '*') return true
    if (entry.startsWith('*.')) {
      if (host.endsWith(`.${entry.slice(2)}`)) return true
    } else if (entry.endsWith('*')) {
      if (host.startsWith(entry.slice(0, -1))) return true
    } else if (host === entry) {
      return true
    }
  }
  return false
}

const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

/** reqwest HeaderValue accepts tab, visible ASCII, and obs-text bytes. */
function isValidHeaderValue(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code === 0x09) continue
    if (code >= 0x20 && code !== 0x7f) continue
    return false
  }
  return true
}

/** Validates the untrusted header map; returns normalized entries. */
export function convertHeaders(headers: Record<string, string>): [string, string][] {
  const entries = Object.entries(headers)
  if (entries.length > MAX_DOWNLOAD_HEADERS) {
    throw new Error(`Too many download headers (maximum ${MAX_DOWNLOAD_HEADERS})`)
  }
  let totalBytes = 0
  for (const [name, value] of entries) {
    totalBytes += name.length + value.length
    if (totalBytes > MAX_DOWNLOAD_HEADER_BYTES) {
      throw new Error(`Download headers exceed the ${MAX_DOWNLOAD_HEADER_BYTES}-byte limit`)
    }
  }
  for (const [name, value] of entries) {
    if (!HEADER_NAME_RE.test(name)) {
      throw new Error(`invalid HTTP header name: ${name}`)
    }
    if (MANAGED_REQUEST_HEADERS.has(name.toLowerCase())) {
      throw new Error(`Download header '${name.toLowerCase()}' is managed by the HTTP client`)
    }
    if (!isValidHeaderValue(value)) {
      throw new Error(`failed to parse header value for '${name}'`)
    }
  }
  return entries
}
