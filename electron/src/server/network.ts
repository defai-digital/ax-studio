// Network + HTTP security helpers (Node ports of src-tauri/utils/src/
// network.rs, http.rs and the remove_prefix helper in path.rs). Pure
// functions — no Electron coupling.

/** rust IpAddr::is_private / is_loopback / is_link_local / is_unspecified for IPv4. */
export function isPrivateIpv4(octets: number[]): boolean {
  const [a, b, c] = octets
  return (
    a === 127 || // loopback 127.0.0.0/8
    a === 10 || // RFC 1918
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) || // link-local
    a === 0 || // "this network" (RFC 1122)
    (a === 100 && b >= 64 && b <= 127) || // shared address space (RFC 6598)
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 // multicast / reserved / broadcast
  )
}

/** Parse an IPv6 literal into 8 16-bit segments, or null when invalid. */
export function parseIpv6Segments(input: string): number[] | null {
  let address = input
  // Embedded IPv4 tail (e.g. ::ffff:1.2.3.4) — expand into two hex segments.
  const ipv4Match = address.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  let ipv4Segments: number[] = []
  if (ipv4Match) {
    const octets = ipv4Match.slice(1).map(Number)
    if (octets.some((o) => o > 255)) return null
    ipv4Segments = [((octets[0] << 8) | octets[1]) >>> 0, ((octets[2] << 8) | octets[3]) >>> 0]
    address = address.slice(0, address.length - ipv4Match[0].length)
    if (address.length > 0 && !address.endsWith(':')) return null
  }

  const doubleColon = address.indexOf('::')
  const hasCompression = doubleColon !== -1
  let head: string[]
  let tail: string[]
  if (hasCompression) {
    if (address.indexOf('::', doubleColon + 2) !== -1) return null
    head = address.slice(0, doubleColon).split(':').filter((p) => p.length > 0)
    tail = address.slice(doubleColon + 2).split(':').filter((p) => p.length > 0)
  } else {
    head = address.split(':')
    tail = []
  }

  const parseGroup = (group: string): number | null => {
    if (group.length < 1 || group.length > 4 || !/^[0-9a-fA-F]+$/.test(group)) return null
    return parseInt(group, 16)
  }

  const headSegments: number[] = []
  for (const group of head) {
    const value = parseGroup(group)
    if (value === null) return null
    headSegments.push(value)
  }
  const tailSegments: number[] = []
  for (const group of tail) {
    const value = parseGroup(group)
    if (value === null) return null
    tailSegments.push(value)
  }

  const total = headSegments.length + tailSegments.length + ipv4Segments.length
  if (hasCompression) {
    if (total >= 8) return null
    const zeros = new Array(8 - total).fill(0)
    return [...headSegments, ...zeros, ...tailSegments, ...ipv4Segments]
  }
  if (total !== 8 || ipv4Segments.length > 2) return null
  return [...headSegments, ...ipv4Segments]
}

/** rust is_private_ip for IPv6 (src-tauri/utils/src/network.rs). */
export function isPrivateIpv6(segments: number[]): boolean {
  const [s0, s1] = segments
  if (segments.every((s) => s === 0)) return true // :: unspecified
  if (segments.slice(0, 7).every((s) => s === 0) && segments[7] === 1) return true // ::1
  // IPv4-compatible / IPv4-mapped — Rust converts via to_ipv4() which covers
  // both ::a.b.c.d (deprecated compatible) and ::ffff:a.b.c.d (mapped).
  if (segments.slice(0, 5).every((s) => s === 0) && (segments[5] === 0xffff || segments[5] === 0)) {
    if (segments[5] === 0xffff || segments.slice(0, 6).every((s) => s === 0)) {
      const octets = [
        segments[6] >> 8,
        segments[6] & 0xff,
        segments[7] >> 8,
        segments[7] & 0xff,
      ]
      return isPrivateIpv4(octets)
    }
  }
  const byte0 = (s0 >> 8) & 0xff
  const byte1 = s0 & 0xff
  return (
    (byte0 & 0xfe) === 0xfe && (byte1 & 0xc0) === 0x80 // fe80::/10 link-local
      ? true
      : (byte0 & 0xfe) === 0xfc || // fc00::/7 unique local
        (byte0 === 0xfe && (byte1 & 0xc0) === 0xc0) || // fec0::/10 site-local
        byte0 === 0xff || // multicast
        (s0 === 0x2001 && s1 === 0x0db8) // documentation prefix
  )
}

/** is_private_ip for a textual IP (v4 dotted or v6 literal). */
export function isPrivateIp(ip: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const octets = ip.split('.').map(Number)
    if (octets.some((o) => o > 255)) return true
    return isPrivateIpv4(octets)
  }
  const segments = parseIpv6Segments(ip)
  if (segments) return isPrivateIpv6(segments)
  return true // unparseable — treat as non-global, mirroring Rust's conservative stance
}

/** rust is_internal_url: conservative — anything unparseable or non-http(s) is internal. */
export function isInternalUrl(rawUrl: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return true
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true
  const host = parsed.hostname // brackets stripped for IPv6, lowercased
  if (host.length === 0) return true
  if (host.includes(':') || parseIpv6Segments(host)) {
    return isPrivateIp(host)
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
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

/** is_cors_header (src-tauri/utils/src/http.rs). */
export function isCorsHeader(headerName: string): boolean {
  return headerName.toLowerCase().startsWith('access-control-')
}

/** Strip an optional port from a Host header value (handles [ipv6]:port and ::1). */
function stripHostPort(host: string): string {
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return end === -1 ? host : host.slice(1, end)
  }
  if (host.split(':').length - 1 >= 2) return host // unbracketed IPv6
  return host.split(':')[0]
}

/** is_valid_host (src-tauri/utils/src/http.rs): loopback + webview origins + trusted list. */
export function isValidHost(host: string, trustedHosts: string[][]): boolean {
  if (trustedHosts.some((hosts) => hosts.includes('*'))) return true
  if (host.length === 0) return false

  const hostWithoutPort = stripHostPort(host)
  const defaultValidHosts = ['localhost', '127.0.0.1', '::1', 'tauri.localhost']
  if (defaultValidHosts.some((valid) => hostWithoutPort.toLowerCase() === valid)) {
    return true
  }

  return trustedHosts.flat().some((valid) => {
    const hostLower = host.toLowerCase()
    const validLower = valid.toLowerCase()
    if (hostLower === validLower) return true
    return hostWithoutPort.toLowerCase() === stripHostPort(valid).toLowerCase()
  })
}

/** remove_prefix (src-tauri/utils/src/path.rs): strip only on a segment boundary. */
export function removePrefix(path: string, prefix: string): string {
  if (prefix.length === 0 || !path.startsWith(prefix)) return path
  const rest = path.slice(prefix.length)
  if (rest.length > 0 && !rest.startsWith('/')) return path
  return rest.length === 0 ? '/' : rest
}
