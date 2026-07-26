// HTTP transport for downloads: DNS pinning, redirect policy, proxy support,
// and resume semantics. Node port of
// src-tauri/src/core/downloads/http_client.rs and the preflight half of
// src-tauri/src/core/network_security.rs.
import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import {
  errToString,
  isPrivateIp,
  privateDownloadsAllowed,
  shouldBypassProxy,
  validateDownloadUrl,
  type DownloadItem,
  type ProxyConfig,
} from './policy.js'
import type { DownloadCancelToken } from './manager.js'

const MAX_REDIRECTS = 10
const MAX_ERROR_BODY_BYTES = 8 * 1024
const DNS_TIMEOUT_MS = 5000

export interface DownloadResponse {
  status: number
  headers: http.IncomingHttpHeaders
  stream: http.IncomingMessage
  contentLength: number | null
  actualUrl: string
}

function normalizeHost(host: string): string {
  return host.replace(/\.+$/, '').toLowerCase()
}

/**
 * reqwest's connect-time PublicDnsResolver analogue: validates the exact
 * addresses handed to the socket, closing the DNS check/use gap. Private
 * answers are rejected unless the host is an explicitly allowed private
 * proxy host (or the smoke-only override is active).
 */
function makeValidatedLookup(allowedPrivateHost?: string): typeof dns.lookup {
  const lookup = (
    hostname: string,
    options: dns.LookupOptions,
    callback: (
      err: NodeJS.ErrnoException | null,
      address?: string | dns.LookupAddress[],
      family?: number
    ) => void
  ): void => {
    dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
      if (err) {
        callback(err)
        return
      }
      if (!addresses || addresses.length === 0) {
        callback(new Error(`DNS returned no addresses for ${hostname}`))
        return
      }
      const allowPrivate =
        allowedPrivateHost !== undefined && normalizeHost(hostname) === allowedPrivateHost
      if (
        !allowPrivate &&
        !privateDownloadsAllowed() &&
        addresses.some((address) => isPrivateIp(address.address))
      ) {
        callback(new Error(`${hostname} resolves to an internal/private or reserved address`))
        return
      }
      if (options.all) callback(null, addresses)
      else callback(null, addresses[0].address, addresses[0].family)
    })
  }
  return lookup as typeof dns.lookup
}

/** Resolve a parsed outbound URL now and reject any mixed/private answer. */
async function validatePublicUrlDns(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(host) !== 0) {
    if (!privateDownloadsAllowed() && isPrivateIp(host)) {
      throw new Error('Outbound URL points to an internal/private or reserved address')
    }
    return
  }
  if (privateDownloadsAllowed()) return
  let addresses: dns.LookupAddress[]
  try {
    addresses = await Promise.race([
      dns.promises.lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('DNS resolution timed out')), DNS_TIMEOUT_MS)
      ),
    ])
  } catch (error) {
    throw new Error(
      `Unsafe outbound host '${host}': ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (addresses.length === 0) {
    throw new Error(`Unsafe outbound host '${host}': DNS returned no addresses for ${host}`)
  }
  if (addresses.some((address) => isPrivateIp(address.address))) {
    throw new Error(
      `Unsafe outbound host '${host}': ${host} resolves to an internal/private or reserved address`
    )
  }
}

function portOf(url: URL): string {
  return url.port || (url.protocol === 'https:' ? '443' : '80')
}

function sameOrigin(left: URL, right: URL): boolean {
  return (
    left.protocol === right.protocol &&
    left.hostname === right.hostname &&
    portOf(left) === portOf(right)
  )
}

function contentRangeStart(headers: http.IncomingHttpHeaders): number | null {
  const value = headers['content-range']
  if (typeof value !== 'string') return null
  const match = value.match(/^bytes (\d+)-/)
  return match ? Number(match[1]) : null
}

function activeProxy(item: DownloadItem): ProxyConfig | null {
  const proxy = item.proxy
  if (!proxy) return null
  if (shouldBypassProxy(item.url, proxy.no_proxy ?? [])) return null
  return proxy
}

function proxyAuthorization(proxy: ProxyConfig): string | null {
  if (proxy.username === undefined || proxy.password === undefined) return null
  return `Basic ${Buffer.from(`${proxy.username}:${proxy.password}`, 'utf8').toString('base64')}`
}

interface SendOnceOptions {
  method: 'GET' | 'HEAD'
  url: URL
  headers: [string, string][]
  rangeStart: number | null
  timeoutSecs: number
  item: DownloadItem
  token?: DownloadCancelToken
}

/**
 * Issues a single request (no redirect following) and resolves with the
 * response as soon as headers arrive. The caller owns the body stream. The
 * timeout covers connect + response headers, matching the reqwest timeouts in
 * send_download_request (10s HEAD / 30s GET); body streaming is untimed, as in
 * the Rust implementation.
 */
function sendOnce(options: SendOnceOptions): Promise<http.IncomingMessage> {
  const { method, url, timeoutSecs, item, token } = options
  const proxy = activeProxy(item)
  const ignoreSsl = item.proxy?.ignore_ssl === true

  return new Promise((resolve, reject) => {
    let settled = false
    let request: http.ClientRequest | null = null
    let tunnelSocket: net.Socket | tls.TLSSocket | null = null

    const cleanup = (): void => {
      clearTimeout(timer)
      offCancel?.()
    }
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      request?.destroy()
      tunnelSocket?.destroy()
      reject(error)
    }
    const succeed = (response: http.IncomingMessage): void => {
      if (settled) {
        response.destroy()
        return
      }
      settled = true
      cleanup()
      resolve(response)
    }
    const timer = setTimeout(
      () => fail(new Error(`Request timed out after ${timeoutSecs}s`)),
      timeoutSecs * 1000
    )
    const offCancel = token?.onCancel(() => fail(new Error('Download cancelled')))
    const onRequestError = (error: Error): void => fail(new Error(errToString(error)))

    const headers: Record<string, string> = {}
    for (const [name, value] of options.headers) headers[name] = value
    if (options.rangeStart !== null && options.rangeStart > 0) {
      headers['Range'] = `bytes=${options.rangeStart}-`
    }

    if (proxy === null) {
      const isHttps = url.protocol === 'https:'
      const transport = isHttps ? https : http
      request = transport.request({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port === '' ? undefined : Number(url.port),
        path: url.pathname + url.search,
        method,
        headers,
        agent: new transport.Agent({ keepAlive: false, lookup: makeValidatedLookup() }),
        rejectUnauthorized: !ignoreSsl,
      })
      request.on('response', succeed)
      request.on('error', onRequestError)
      request.end()
      return
    }

    const proxyUrl = new URL(proxy.url)
    const proxyIsHttps = proxyUrl.protocol === 'https:'
    const proxyTransport = proxyIsHttps ? https : http
    const proxyPort = proxyUrl.port === '' ? (proxyIsHttps ? 443 : 80) : Number(proxyUrl.port)
    const proxyAgent = new proxyTransport.Agent({
      keepAlive: false,
      // The proxy host may intentionally be private; destination hosts are
      // still validated by the per-hop preflight in sendDownloadRequest.
      lookup: makeValidatedLookup(normalizeHost(proxyUrl.hostname)),
    })
    const auth = proxyAuthorization(proxy)

    if (url.protocol === 'http:') {
      // Plain HTTP through a proxy: absolute-form request target.
      const proxyHeaders: Record<string, string> = { ...headers, Host: url.host }
      if (auth !== null) proxyHeaders['Proxy-Authorization'] = auth
      request = proxyTransport.request({
        hostname: proxyUrl.hostname,
        port: proxyPort,
        path: url.toString(),
        method,
        headers: proxyHeaders,
        agent: proxyAgent,
        rejectUnauthorized: true,
      })
      request.on('response', succeed)
      request.on('error', onRequestError)
      request.end()
      return
    }

    // HTTPS through a proxy: CONNECT tunnel, then TLS over the tunnel.
    const targetPort = Number(portOf(url))
    const connectHeaders: Record<string, string> = { Host: `${url.hostname}:${targetPort}` }
    if (auth !== null) connectHeaders['Proxy-Authorization'] = auth
    const connectRequest = proxyTransport.request({
      hostname: proxyUrl.hostname,
      port: proxyPort,
      method: 'CONNECT',
      path: `${url.hostname}:${targetPort}`,
      headers: connectHeaders,
      agent: proxyAgent,
      rejectUnauthorized: true,
    })
    request = connectRequest
    connectRequest.on('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy()
        fail(new Error(`Proxy CONNECT failed: HTTP status ${response.statusCode}`))
        return
      }
      tunnelSocket = socket
      const tlsSocket = tls.connect(
        { socket, servername: url.hostname, rejectUnauthorized: !ignoreSsl },
        () => {
          const inner = https.request({
            hostname: url.hostname,
            port: targetPort,
            path: url.pathname + url.search,
            method,
            headers,
            createConnection: () => tlsSocket,
            agent: false,
          })
          request = inner
          inner.on('response', succeed)
          inner.on('error', onRequestError)
          inner.end()
        }
      )
      tlsSocket.on('error', onRequestError)
    })
    connectRequest.on('error', onRequestError)
    connectRequest.end()
  })
}

/**
 * Mirrors send_download_request: manual redirect chain (reqwest redirect
 * policy `none`), per-hop URL + DNS validation, caller headers forwarded only
 * on the original origin, and HTTPS→HTTP downgrade refusal.
 */
async function sendDownloadRequest(
  method: 'GET' | 'HEAD',
  rawUrl: string,
  headerEntries: [string, string][],
  rangeStart: number | null,
  timeoutSecs: number,
  item: DownloadItem,
  token?: DownloadCancelToken
): Promise<DownloadResponse> {
  const originalUrl = validateDownloadUrl(rawUrl)
  let currentUrl = originalUrl

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    validateDownloadUrl(currentUrl.toString())
    await validatePublicUrlDns(currentUrl)

    const response = await sendOnce({
      method,
      url: currentUrl,
      headers: sameOrigin(originalUrl, currentUrl) ? headerEntries : [],
      rangeStart,
      timeoutSecs,
      item,
      token,
    })

    if (![301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
      const contentLengthHeader = response.headers['content-length']
      const parsedLength =
        typeof contentLengthHeader === 'string' ? Number(contentLengthHeader) : Number.NaN
      return {
        status: response.statusCode ?? 0,
        headers: response.headers,
        stream: response,
        contentLength:
          Number.isFinite(parsedLength) && parsedLength > 0 ? parsedLength : null,
        actualUrl: currentUrl.toString(),
      }
    }
    response.destroy()
    if (redirectCount === MAX_REDIRECTS) {
      throw new Error(`Download exceeded the ${MAX_REDIRECTS}-redirect limit`)
    }

    const location = response.headers.location
    if (typeof location !== 'string') {
      throw new Error('Download redirect is missing a Location header')
    }
    let nextUrl: URL
    try {
      nextUrl = new URL(location, currentUrl)
    } catch {
      throw new Error('Download redirect Location is invalid')
    }
    if (currentUrl.protocol === 'https:' && nextUrl.protocol !== 'https:') {
      throw new Error('Refusing to follow an HTTPS download redirect to insecure HTTP')
    }
    validateDownloadUrl(nextUrl.toString())
    currentUrl = nextUrl
  }
  throw new Error('Download redirect handling failed unexpectedly')
}

async function readErrorBodyLimited(stream: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of stream) {
      const buffer = chunk as Buffer
      const remaining = MAX_ERROR_BODY_BYTES - size
      if (remaining <= 0) break
      const slice = buffer.subarray(0, Math.min(buffer.length, remaining))
      chunks.push(slice)
      size += slice.length
      if (size >= MAX_ERROR_BODY_BYTES) break
    }
  } catch {
    // A truncated error body is still useful context.
  }
  stream.destroy()
  let text = Buffer.concat(chunks).toString('utf8').trim()
  if (size >= MAX_ERROR_BODY_BYTES) text += '…'
  return text
}

export async function getFileSize(
  item: DownloadItem,
  headerEntries: [string, string][],
  token?: DownloadCancelToken
): Promise<number> {
  const response = await sendDownloadRequest('HEAD', item.url, headerEntries, null, 10, item, token)
  response.stream.destroy()
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Failed to get file size: HTTP status ${response.status}`)
  }
  return response.contentLength ?? 0
}

/**
 * GET with optional resume (`Range: bytes=<startBytes>-`). Mirrors
 * get_maybe_resume: a resume requires 206 + a matching Content-Range start; a
 * fresh download requires any 2xx.
 */
export async function openDownloadStream(
  item: DownloadItem,
  startBytes: number,
  headerEntries: [string, string][],
  token: DownloadCancelToken
): Promise<DownloadResponse> {
  const response = await sendDownloadRequest(
    'GET',
    item.url,
    headerEntries,
    startBytes > 0 ? startBytes : null,
    30,
    item,
    token
  )

  if (startBytes > 0) {
    if (response.status !== 206) {
      const body = await readErrorBodyLimited(response.stream)
      throw new Error(
        `Failed to resume download: HTTP status ${response.status}${body === '' ? '' : `, ${body}`}`
      )
    }
    if (contentRangeStart(response.headers) !== startBytes) {
      response.stream.destroy()
      throw new Error(
        `Failed to resume download: server returned an invalid Content-Range for byte ${startBytes}`
      )
    }
  } else if (response.status < 200 || response.status >= 300) {
    const body = await readErrorBodyLimited(response.stream)
    throw new Error(
      `Failed to download: HTTP status ${response.status}${body === '' ? '' : `, ${body}`}`
    )
  }

  return response
}
