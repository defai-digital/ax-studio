// Internal API proxy (Node port of src-tauri/src/core/server/: proxy.rs,
// model_routes.rs, gateway_routes.rs, security.rs, cors.rs, proxy_server.rs,
// commands.rs). Loopback OpenAI-compatible gateway that routes model requests
// to registered providers and injects their credentials upstream, so renderer
// requests never carry real API keys.
//
// Deliberate deviations from the Rust implementation:
//  - The Anthropic `/messages` → OpenAI chat/completions adapter is NOT ported:
//    the web-app speaks OpenAI-compatible /chat/completions for every provider
//    (web-app/src/lib/model-factory.ts) and the migration plan removes the
//    external local-API-server feature that adapter served. POST /messages
//    returns 404 like any other unknown route.
//  - Origin "null" (Electron packaged renderer loading via file://) is treated
//    as a trusted local origin, the same way tauri://localhost was.
//  - Upstream response `content-encoding` is stripped when forwarding: Node's
//    fetch transparently decompresses, so forwarding the header would make the
//    client decode twice.
import { createHash, timingSafeEqual } from 'node:crypto'
import dns from 'node:dns/promises'
import http from 'node:http'
import net from 'node:net'
import { StringDecoder } from 'node:string_decoder'
import { Readable } from 'node:stream'
import {
  isCorsHeader,
  isInternalUrl,
  isPrivateIp,
  isValidHost,
  removePrefix,
} from './network.js'
import {
  activeStreams,
  providerAllowsInternalNetwork,
  providerConfigs,
  providerModelIndex,
  type ProviderCustomHeader,
} from './providers.js'

// ─── Constants (cors.rs / model_routes.rs) ──────────────────────────────────

const CORS_ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']
const CORS_ALLOWED_METHODS_HEADER = 'GET, POST, PUT, DELETE, OPTIONS, PATCH'
const CORS_RESPONSE_ALLOWED_HEADERS_HEADER =
  'Authorization, Content-Type, Host, Accept, Accept-Language, Cache-Control, Connection, DNT, If-Modified-Since, Keep-Alive, Origin, User-Agent, X-Requested-With, X-CSRF-Token, X-Forwarded-For, X-Forwarded-Proto, X-Forwarded-Host, authorization, content-type, x-api-key, x-ax-provider, x-ax-request-role'
const CORS_PREFLIGHT_ALLOWED_HEADERS = [
  'accept',
  'accept-language',
  'authorization',
  'cache-control',
  'connection',
  'content-type',
  'dnt',
  'host',
  'if-modified-since',
  'keep-alive',
  'origin',
  'user-agent',
  'x-api-key',
  'x-csrf-token',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-requested-with',
  'x-stainless-arch',
  'x-stainless-lang',
  'x-stainless-os',
  'x-stainless-package-version',
  'x-stainless-retry-count',
  'x-stainless-runtime',
  'x-stainless-runtime-version',
  'x-stainless-timeout',
  'x-ax-provider',
  'x-ax-request-role',
]

const WHITELISTED_PATHS = new Set(['/favicon.ico'])
const MAX_AUTH_FAILURES = 10
const AUTH_LOCKOUT_MS = 60_000
const AUTH_MAX_ENTRIES = 1024
const MODEL_LOAD_RETRY_ATTEMPTS = 10
const MODEL_LOAD_RETRY_DELAY_MS = 500
const UPSTREAM_DNS_LOOKUP_TIMEOUT_MS = 5_000
const MAX_SSE_LINE_BUFFER = 1_048_576
const MAX_MODEL_REQUEST_BODY_SIZE = 10 * 1024 * 1024

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

export interface ProxyConfig {
  prefix: string
  proxyApiKey: string
  trustedHosts: string[][]
  corsEnabled: boolean
  verboseLogs: boolean
  host: string
}

// ─── Auth failure rate limiting (proxy.rs) ──────────────────────────────────

const authFailures = new Map<string, { count: number; firstFailure: number }>()

function purgeStaleAuthEntries(): void {
  const now = Date.now()
  for (const [key, entry] of authFailures) {
    if (now - entry.firstFailure >= AUTH_LOCKOUT_MS) authFailures.delete(key)
  }
}

function isRateLimited(clientId: string): boolean {
  purgeStaleAuthEntries()
  const entry = authFailures.get(clientId)
  if (!entry) return false
  if (entry.count >= MAX_AUTH_FAILURES && Date.now() - entry.firstFailure < AUTH_LOCKOUT_MS) {
    return true
  }
  if (Date.now() - entry.firstFailure >= AUTH_LOCKOUT_MS) authFailures.delete(clientId)
  return false
}

function recordAuthFailure(clientId: string): void {
  purgeStaleAuthEntries()
  if (!authFailures.has(clientId) && authFailures.size >= AUTH_MAX_ENTRIES) {
    let oldestKey: string | null = null
    let oldest = Infinity
    for (const [key, entry] of authFailures) {
      if (entry.firstFailure < oldest) {
        oldest = entry.firstFailure
        oldestKey = key
      }
    }
    if (oldestKey !== null) authFailures.delete(oldestKey)
  }
  const entry = authFailures.get(clientId) ?? { count: 0, firstFailure: Date.now() }
  entry.count += 1
  authFailures.set(clientId, entry)
}

function clearAuthFailure(clientId: string): void {
  authFailures.delete(clientId)
}

function constantTimeSecretEq(candidate: string, expected: string): boolean {
  const a = createHash('sha256').update(candidate, 'utf8').digest()
  const b = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(a, b)
}

function extractBearerToken(authStr: string): string | null {
  const trimmed = authStr.trim()
  const match = trimmed.match(/^(\S+)(?:\s+(.*))?$/)
  if (!match || match[1].toLowerCase() !== 'bearer') return null
  const token = (match[2] ?? '').trim()
  return token.length > 0 ? token : null
}

// ─── CORS helpers (security.rs) ─────────────────────────────────────────────

function firstHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

function trustedCorsOrigin(origin: string, host: string, trustedHosts: string[][]): string | null {
  if (origin.length === 0) return null
  // Electron packaged renderer loads via file:// and sends Origin: null; the
  // Tauri webview equivalent (tauri://localhost) was trusted by default.
  if (origin === 'null') return 'null'

  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return null
  }
  if (!['http:', 'https:', 'tauri:'].includes(parsed.protocol)) return null

  const originHost = parsed.hostname
  if (originHost.length === 0) return null
  const originHostWithPort = parsed.port.length > 0 ? `${originHost}:${parsed.port}` : originHost

  if (host.length > 0 && !isValidHost(host, trustedHosts)) return null
  if (!isValidHost(originHostWithPort, trustedHosts)) return null
  return origin
}

/**
 * Mirrors add_cors_headers_with_host_and_origin: when CORS is disabled, still
 * emit headers for local origins hitting the loopback proxy (the webview uses
 * native fetch for SSE streaming, which enforces CORS).
 */
function corsResponseHeaders(
  host: string,
  origin: string,
  config: ProxyConfig
): Record<string, string> {
  if (!config.corsEnabled) {
    const isLoopbackHost = isValidHost(host, [])
    const isLocalOrigin =
      origin === 'null' ||
      origin.startsWith('tauri://') ||
      origin.startsWith('https://tauri.') ||
      origin.startsWith('http://tauri.') ||
      origin.startsWith('http://localhost') ||
      origin.startsWith('http://127.0.0.1')
    if (!(isLoopbackHost && isLocalOrigin)) return {}
  }

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': CORS_ALLOWED_METHODS_HEADER,
    'Access-Control-Allow-Headers': CORS_RESPONSE_ALLOWED_HEADERS_HEADER,
    Vary: 'Origin',
  }
  const allowOrigin = trustedCorsOrigin(origin, host, config.trustedHosts)
  if (allowOrigin !== null) {
    headers['Access-Control-Allow-Origin'] = allowOrigin
    headers['Access-Control-Allow-Credentials'] = 'true'
  }
  return headers
}

function respond(
  res: http.ServerResponse,
  status: number,
  body: string,
  hostHeader: string,
  originHeader: string,
  config: ProxyConfig,
  extraHeaders: Record<string, string> = {}
): void {
  if (res.writableEnded) return
  res.writeHead(status, {
    ...corsResponseHeaders(hostHeader, originHeader, config),
    ...extraHeaders,
  })
  res.end(body)
}

// ─── CORS preflight (proxy.rs handle_cors_preflight) ────────────────────────

function handleCorsPreflight(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: ProxyConfig
): boolean {
  if (req.method !== 'OPTIONS') return false

  const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(config.host)
  if (!config.corsEnabled && !isLoopback) {
    respond(res, 403, 'CORS is disabled', '', '', config)
    return true
  }

  const host = firstHeader(req.headers.host)
  const origin = firstHeader(req.headers.origin)
  const requestedMethod = firstHeader(req.headers['access-control-request-method'])

  const methodAllowed =
    requestedMethod.length === 0 ||
    CORS_ALLOWED_METHODS.some((method) => method.toLowerCase() === requestedMethod.toLowerCase())
  if (!methodAllowed) {
    respond(res, 405, 'Method not allowed', host, origin, config)
    return true
  }

  const requestPath = (req.url ?? '/').split('?')[0]
  const isTrusted = WHITELISTED_PATHS.has(requestPath)
    ? true
    : host.length > 0
      ? isValidHost(host, config.trustedHosts)
      : false
  if (!isTrusted) {
    respond(res, 403, 'Host not allowed', host, origin, config)
    return true
  }

  const requestedHeaders = firstHeader(req.headers['access-control-request-headers'])
  const headersValid =
    requestedHeaders.length === 0 ||
    requestedHeaders
      .split(',')
      .map((header) => header.trim())
      .every((header) =>
        CORS_PREFLIGHT_ALLOWED_HEADERS.some(
          (allowed) => allowed.toLowerCase() === header.toLowerCase()
        )
      )
  if (!headersValid) {
    respond(res, 403, 'Headers not allowed', host, origin, config)
    return true
  }

  const allowOrigin = trustedCorsOrigin(origin, host, config.trustedHosts)
  if (allowOrigin === null && origin.length > 0) {
    respond(res, 403, 'Origin not allowed', host, origin, config)
    return true
  }

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': CORS_ALLOWED_METHODS_HEADER,
    'Access-Control-Allow-Headers': CORS_RESPONSE_ALLOWED_HEADERS_HEADER,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
  }
  if (allowOrigin !== null) {
    headers['Access-Control-Allow-Origin'] = allowOrigin
    headers['Access-Control-Allow-Credentials'] = 'true'
  }
  res.writeHead(200, headers)
  res.end()
  return true
}

// ─── Request validation (proxy.rs validate_request) ─────────────────────────

function validateRequest(
  path: string,
  hostHeader: string,
  originHeader: string,
  headers: http.IncomingHttpHeaders,
  config: ProxyConfig,
  clientId: string,
  res: http.ServerResponse
): boolean {
  const isWhitelistedPath = WHITELISTED_PATHS.has(path)

  if (!isWhitelistedPath) {
    if (hostHeader.length > 0) {
      if (!isValidHost(hostHeader, config.trustedHosts)) {
        respond(res, 403, 'Invalid host header', hostHeader, originHeader, config)
        return false
      }
    } else {
      respond(res, 400, 'Missing host header', hostHeader, originHeader, config)
      return false
    }
  }

  // Reject untrusted browser origins independently of CORS response headers so
  // loopback/no-auth mode cannot be used for CSRF.
  if (
    !isWhitelistedPath &&
    originHeader.length > 0 &&
    trustedCorsOrigin(originHeader, hostHeader, config.trustedHosts) === null
  ) {
    respond(res, 403, 'Origin not allowed', hostHeader, originHeader, config)
    return false
  }

  if (!isWhitelistedPath && config.proxyApiKey.length > 0) {
    const authValid = (() => {
      const token = extractBearerToken(firstHeader(headers.authorization) || ' ')
      return token !== null && constantTimeSecretEq(token, config.proxyApiKey)
    })()
    const apiKeyHeader = firstHeader(headers['x-api-key'])
    const apiKeyValid =
      apiKeyHeader.length > 0 && constantTimeSecretEq(apiKeyHeader, config.proxyApiKey)

    if (authValid || apiKeyValid) {
      clearAuthFailure(clientId)
    } else {
      const rateLimited = isRateLimited(clientId)
      if (!rateLimited) recordAuthFailure(clientId)
      respond(
        res,
        rateLimited ? 429 : 401,
        rateLimited
          ? 'Too many failed authentication attempts. Try again later.'
          : 'Invalid or missing authorization token',
        hostHeader,
        originHeader,
        config
      )
      return false
    }
  }
  // Empty proxy api key → loopback-only no-auth mode; start_server only allows
  // this when binding loopback with CORS disabled.

  if (path === '/configs' || path.startsWith('/configs/') || path.startsWith('/configs?')) {
    respond(res, 404, 'Not Found', hostHeader, originHeader, config)
    return false
  }

  return true
}

// ─── GET /models (gateway_routes.rs) ────────────────────────────────────────

function handleModelsRoute(
  hostHeader: string,
  originHeader: string,
  config: ProxyConfig,
  res: http.ServerResponse
): void {
  const models: unknown[] = []
  for (const providerConfig of providerConfigs.values()) {
    const ownedBy =
      providerConfig.base_url !== null && isInternalUrl(providerConfig.base_url)
        ? 'local'
        : 'remote'
    for (const modelId of providerConfig.models) {
      models.push({ id: modelId, object: 'model', created: 1, owned_by: ownedBy })
    }
  }
  respond(res, 200, JSON.stringify({ object: 'list', data: models }), hostHeader, originHeader, config, {
    'Content-Type': 'application/json',
  })
}

// ─── Request body normalization (model_routes.rs) ───────────────────────────

type JsonRecord = Record<string, unknown>

function messageHasToolState(msg: JsonRecord): boolean {
  if (msg.role === 'tool') return true
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) return true
  return (
    Array.isArray(msg.content) &&
    (msg.content as JsonRecord[]).some(
      (part) => part !== null && typeof part === 'object' && (part.type === 'tool_result' || part.type === 'tool_use')
    )
  )
}

function requestHasToolState(jsonBody: JsonRecord): boolean {
  if (Array.isArray(jsonBody.tools) && jsonBody.tools.length > 0) return true
  if (!Array.isArray(jsonBody.messages)) return false
  const messages = jsonBody.messages as JsonRecord[]
  const last = messages[messages.length - 1]
  return (last !== undefined && last.role === 'assistant') || messages.some(messageHasToolState)
}

function requestHasLocalKnowledgeContext(jsonBody: JsonRecord): boolean {
  if (!Array.isArray(jsonBody.messages)) return false
  return (jsonBody.messages as JsonRecord[]).some((message) => {
    if (typeof message.content === 'string') {
      return message.content.includes('Local Knowledge Base (ACTIVE)')
    }
    return (
      Array.isArray(message.content) &&
      (message.content as JsonRecord[]).some(
        (part) => typeof part?.text === 'string' && part.text.includes('Local Knowledge Base (ACTIVE)')
      )
    )
  })
}

function disableThinkingForDeterministicAnswer(jsonBody: JsonRecord): boolean {
  if (!requestHasToolState(jsonBody) && !requestHasLocalKnowledgeContext(jsonBody)) return false
  if (jsonBody.chat_template_kwargs === null || typeof jsonBody.chat_template_kwargs !== 'object') {
    jsonBody.chat_template_kwargs = {}
  }
  ;(jsonBody.chat_template_kwargs as JsonRecord).enable_thinking = false
  return true
}

/**
 * Strip non-standard fields upstream providers reject (reasoning_content /
 * reasoning on assistant messages). chat_template_kwargs is only forwarded to
 * llama.cpp-style local routes; hosted providers reject it.
 */
function normalizeRequestBody(body: Buffer, allowChatTemplateKwargs: boolean): Buffer {
  let jsonBody: JsonRecord
  try {
    jsonBody = JSON.parse(body.toString('utf8')) as JsonRecord
  } catch {
    return body
  }
  if (jsonBody === null || typeof jsonBody !== 'object') return body

  let modified = false
  if (Array.isArray(jsonBody.messages)) {
    for (const msg of jsonBody.messages as JsonRecord[]) {
      if (msg === null || typeof msg !== 'object' || msg.role !== 'assistant') continue
      if ('reasoning_content' in msg) {
        delete msg.reasoning_content
        modified = true
      }
      if ('reasoning' in msg) {
        delete msg.reasoning
        modified = true
      }
    }
  }

  if (allowChatTemplateKwargs) {
    if (disableThinkingForDeterministicAnswer(jsonBody)) modified = true
  } else if ('chat_template_kwargs' in jsonBody) {
    delete jsonBody.chat_template_kwargs
    modified = true
  }

  return modified ? Buffer.from(JSON.stringify(jsonBody), 'utf8') : body
}

// ─── Model routing (model_routes.rs resolve_model_route) ────────────────────

interface ResolvedProviderConfig {
  targetBaseUrl: string
  sessionApiKey: string | null
  providerCustomHeaders: ProviderCustomHeader[]
  allowChatTemplateKwargs: boolean
  allowInternal: boolean
}

function stripProviderEndpointSuffix(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  for (const suffix of ['/chat/completions', '/completions', '/messages', '/embeddings']) {
    if (trimmed.endsWith(suffix)) {
      return trimmed.slice(0, trimmed.length - suffix.length).replace(/\/+$/, '')
    }
  }
  return trimmed
}

function buildUpstreamUrl(baseUrl: string, destinationPath: string): string {
  return `${stripProviderEndpointSuffix(baseUrl)}${destinationPath}`
}

function findProviderName(modelId: string): { provider: string | null; error: string | null } {
  const sepPos = modelId.indexOf('/')
  if (sepPos !== -1) {
    const potentialProvider = modelId.slice(0, sepPos)
    if (providerConfigs.has(potentialProvider)) {
      return { provider: potentialProvider, error: null }
    }
  }
  const indexed = providerModelIndex.get(modelId) ?? []
  if (indexed.length === 0) {
    return { provider: providerConfigs.get(modelId)?.provider ?? null, error: null }
  }
  if (indexed.length === 1) return { provider: indexed[0], error: null }
  return {
    provider: null,
    error: `Model '${modelId}' is configured for multiple providers. Use 'provider/model' to disambiguate.`,
  }
}

function resolveProviderConfigFromMap(
  modelId: string,
  destinationPath: string
): { resolved: ResolvedProviderConfig | null; error: string | null } {
  const { provider, error } = findProviderName(modelId)
  if (error !== null) return { resolved: null, error }
  if (provider === null) return { resolved: null, error: null }
  const config = providerConfigs.get(provider)
  if (!config) return { resolved: null, error: null }
  const baseUrl = config.base_url
  if (baseUrl === null || baseUrl.length === 0) return { resolved: null, error: null }
  return {
    resolved: {
      targetBaseUrl: buildUpstreamUrl(baseUrl, destinationPath),
      sessionApiKey: config.api_key,
      providerCustomHeaders: config.custom_headers,
      allowChatTemplateKwargs: provider === 'llamacpp',
      allowInternal: providerAllowsInternalNetwork(provider),
    },
    error: null,
  }
}

function resolveModelRoute(
  destinationPath: string,
  body: Buffer,
  providerHint: string | null
): { resolution: ResolvedProviderConfig & { bufferedBody: Buffer } } | { error: { status: number; message: string } } {
  let modelId: string
  try {
    const parsed = JSON.parse(body.toString('utf8')) as JsonRecord
    const model = parsed?.model
    if (typeof model !== 'string') {
      return { error: { status: 400, message: "Request body must contain a 'model' field" } }
    }
    modelId = model
  } catch (error) {
    return { error: { status: 400, message: `Invalid JSON body: ${(error as Error).message}` } }
  }

  let resolved: ResolvedProviderConfig | null = null
  let resolutionError: string | null = null

  if (providerHint !== null && providerConfigs.has(providerHint)) {
    const config = providerConfigs.get(providerHint)!
    const baseUrl = config.base_url
    if (baseUrl !== null && baseUrl.length > 0) {
      resolved = {
        targetBaseUrl: buildUpstreamUrl(baseUrl, destinationPath),
        sessionApiKey: config.api_key,
        providerCustomHeaders: config.custom_headers,
        allowChatTemplateKwargs: providerHint === 'llamacpp',
        allowInternal: providerAllowsInternalNetwork(providerHint),
      }
    } else {
      // Provider registered without a base URL — try the heuristic before
      // failing with an actionable error.
      const heuristic = resolveProviderConfigFromMap(modelId, destinationPath)
      if (heuristic.error === null && heuristic.resolved === null) {
        resolutionError = `Provider '${providerHint}' has no Base URL configured. Set one in Settings → AI Providers → ${providerHint}.`
      } else {
        resolved = heuristic.resolved
        resolutionError = heuristic.error
      }
    }
  } else {
    const heuristic = resolveProviderConfigFromMap(modelId, destinationPath)
    resolved = heuristic.resolved
    resolutionError = heuristic.error
  }

  if (resolutionError !== null) {
    return { error: { status: 409, message: resolutionError } }
  }
  if (resolved === null) {
    return {
      error: { status: 404, message: `No remote provider configured for model '${modelId}'` },
    }
  }
  return {
    resolution: {
      ...resolved,
      bufferedBody: normalizeRequestBody(body, resolved.allowChatTemplateKwargs),
    },
  }
}

// ─── Upstream dispatch (model_routes.rs dispatch_to_upstream) ───────────────

function shouldSkipUpstreamRequestHeader(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    lower === 'host' ||
    lower === 'authorization' ||
    lower === 'content-length' ||
    lower === 'x-api-key' ||
    lower === 'x-ax-provider' ||
    lower === 'x-ax-request-role' ||
    HOP_BY_HOP_HEADERS.has(lower)
  )
}

function isReservedUpstreamCustomHeader(name: string): boolean {
  return (
    [
      'accept-encoding',
      'authorization',
      'connection',
      'content-length',
      'cookie',
      'forwarded',
      'host',
      'origin',
      'proxy-authorization',
      'proxy-connection',
      'referer',
      'te',
      'trailer',
      'transfer-encoding',
      'upgrade',
      'x-api-key',
      'x-forwarded-for',
      'x-forwarded-host',
      'x-forwarded-proto',
    ].includes(name) ||
    name.startsWith('proxy-') ||
    name.startsWith('sec-')
  )
}

function normalizeUpstreamApiKey(apiKey: string | null): string | null {
  if (apiKey === null) return null
  const trimmed = apiKey.trim()
  if (trimmed.length === 0) return null
  const match = trimmed.match(/^(\S+)(?:\s+(.*))?$/)
  const key =
    match && match[1].toLowerCase() === 'bearer' ? (match[2] ?? '').trim() : trimmed
  return key.length > 0 ? key : null
}

function isTransientModelLoadingError(status: number, destinationPath: string, errorBody: string): boolean {
  return (
    status === 404 &&
    destinationPath === '/chat/completions' &&
    errorBody.includes('not loaded') &&
    errorBody.includes('loaded=')
  )
}

function upstreamIpIsForbidden(ip: string, allowInternal: boolean): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 0) return true
    if (a === 169 && b === 254) return true
    if (a >= 224) return true
    return !allowInternal && isPrivateIp(ip)
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase()
    if (lower === '::') return true
    if (/^fe[89ab]/.test(lower)) return true // fe80::/10 link-local
    if (lower.startsWith('ff')) return true
    return !allowInternal && isPrivateIp(ip)
  }
  return true
}

/** Per-request SSRF guard: re-resolve and reject private IPs (DNS rebinding defense). */
async function checkUpstreamNotSsrf(rawUrl: string, allowInternal: boolean): Promise<string | null> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch (error) {
    return `Invalid upstream URL: ${(error as Error).message}`
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    return 'Upstream URL has an unsafe scheme or embedded credentials'
  }
  const host = parsed.hostname
  if (host.length === 0) return 'Upstream URL has no host'
  if (net.isIP(host)) {
    if (upstreamIpIsForbidden(host, allowInternal)) {
      return `Upstream URL points to a forbidden address (${host}); request blocked`
    }
    return null
  }
  if (host === 'localhost') {
    return allowInternal ? null : 'Upstream URL must not point to localhost'
  }
  let addresses: Array<{ address: string }>
  try {
    addresses = await Promise.race([
      dns.lookup(host, { all: true }),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('__timeout__')), UPSTREAM_DNS_LOOKUP_TIMEOUT_MS)
      ),
    ])
  } catch (error) {
    if ((error as Error).message === '__timeout__') {
      return `Timed out resolving upstream host '${host}'`
    }
    return `Failed to resolve upstream host '${host}': ${(error as Error).message}`
  }
  if (addresses.length === 0) return `Upstream host '${host}' did not resolve`
  for (const { address } of addresses) {
    if (upstreamIpIsForbidden(address, allowInternal)) {
      return 'Upstream URL resolves to a forbidden address; request blocked'
    }
  }
  return null
}

/** SSE line patching (model_routes.rs patch_sse_line): fold private reasoning fields into visible content. */
function patchSseLine(line: string): string {
  const trimmed = line.trimStart()
  if (!trimmed.startsWith('data:')) return line
  const prefix = line.slice(0, line.length - trimmed.length)

  const afterData = trimmed.slice(5)
  let payloadStr: string
  let trailingNewline: string
  if (afterData.endsWith('\r\n')) {
    payloadStr = afterData.slice(0, -2).trimStart()
    trailingNewline = '\r\n'
  } else if (afterData.endsWith('\n')) {
    payloadStr = afterData.slice(0, -1).trimStart()
    trailingNewline = '\n'
  } else {
    payloadStr = afterData.trimStart()
    trailingNewline = ''
  }
  if (payloadStr === '[DONE]') return line

  let value: JsonRecord
  try {
    value = JSON.parse(payloadStr) as JsonRecord
  } catch {
    return line
  }
  if (!Array.isArray(value?.choices)) return line

  let changed = false
  for (const choice of value.choices as JsonRecord[]) {
    const delta = choice?.delta
    if (delta === null || typeof delta !== 'object') continue
    const deltaRecord = delta as JsonRecord
    const hasVisibleContent = typeof deltaRecord.content === 'string' && deltaRecord.content.length > 0
    if (!hasVisibleContent) {
      const reasoningFallback =
        (typeof deltaRecord.reasoning_content === 'string' && deltaRecord.reasoning_content.length > 0
          ? deltaRecord.reasoning_content
          : null) ??
        (typeof deltaRecord.reasoning === 'string' && deltaRecord.reasoning.length > 0
          ? deltaRecord.reasoning
          : null)
      if (reasoningFallback !== null) {
        deltaRecord.content = reasoningFallback
        changed = true
      }
    }
    if ('reasoning_content' in deltaRecord) {
      delete deltaRecord.reasoning_content
      changed = true
    }
    if ('reasoning' in deltaRecord) {
      delete deltaRecord.reasoning
      changed = true
    }
  }
  if (!changed) return line
  return `${prefix}data: ${JSON.stringify(value)}${trailingNewline}`
}

interface ProviderResolution {
  targetBaseUrl: string
  sessionApiKey: string | null
  providerCustomHeaders: ProviderCustomHeader[]
  bufferedBody: Buffer
  allowInternal: boolean
}

async function dispatchToUpstream(
  resolution: ProviderResolution,
  destinationPath: string,
  requestHeaders: http.IncomingHttpHeaders,
  hostHeader: string,
  originHeader: string,
  config: ProxyConfig,
  connectTimeoutMs: number,
  res: http.ServerResponse
): Promise<void> {
  const upstreamUrl = resolution.targetBaseUrl
  const sessionApiKey = normalizeUpstreamApiKey(resolution.sessionApiKey)

  // Wire up abort_remote_stream: X-Ax-Stream-Id registers an abort handle.
  const streamIdHeader = firstHeader(requestHeaders['x-ax-stream-id'])
  const streamId = streamIdHeader.length > 0 ? streamIdHeader : null
  const abortController = new AbortController()
  const cleanupStream = () => {
    if (streamId !== null) activeStreams.delete(streamId)
  }
  if (streamId !== null) {
    activeStreams.set(streamId, {
      abort: () => {
        abortController.abort()
        if (!res.writableEnded) res.end()
      },
    })
  }
  // Client disconnect aborts the upstream request.
  res.on('close', () => {
    if (!res.writableEnded) abortController.abort()
    cleanupStream()
  })

  const ssrfError = await checkUpstreamNotSsrf(upstreamUrl, resolution.allowInternal)
  if (ssrfError !== null) {
    console.warn(`[proxy] Per-request SSRF check blocked upstream: ${ssrfError}`)
    cleanupStream()
    respond(res, 403, ssrfError, hostHeader, originHeader, config)
    return
  }

  const outboundHeaders: Record<string, string> = {}
  for (const [name, value] of Object.entries(requestHeaders)) {
    if (shouldSkipUpstreamRequestHeader(name)) continue
    const headerValue = firstHeader(value)
    if (headerValue.length > 0) outboundHeaders[name] = headerValue
  }
  if (sessionApiKey !== null) {
    outboundHeaders.authorization = `Bearer ${sessionApiKey}`
  }
  for (const custom of resolution.providerCustomHeaders) {
    const lower = custom.header.toLowerCase()
    if (isReservedUpstreamCustomHeader(lower)) continue
    if (/[\0\r\n]/.test(custom.value)) continue
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(custom.header)) continue
    outboundHeaders[lower] = custom.value
  }

  let modelLoadAttempts = 0
  for (;;) {
    // Connect timeout only — streaming responses are long-lived, so the timer
    // is cleared as soon as response headers arrive (mirrors reqwest's
    // connect_timeout with no overall timeout).
    const connectTimer = setTimeout(() => abortController.abort(), connectTimeoutMs)
    let response: Response
    try {
      response = await fetch(upstreamUrl, {
        method: 'POST',
        headers: outboundHeaders,
        body: resolution.bufferedBody,
        redirect: 'manual', // never follow redirects to non-validated hosts
        signal: abortController.signal,
      })
    } catch (error) {
      clearTimeout(connectTimer)
      cleanupStream()
      const aborted = abortController.signal.aborted
      const message = aborted
        ? 'Proxy request to model aborted'
        : `Proxy request to model failed: ${(error as Error).message}`
      if (!aborted) console.error(`[proxy] ${message}`)
      respond(res, aborted ? 499 : 502, message, hostHeader, originHeader, config)
      return
    }
    clearTimeout(connectTimer)

    if (!response.ok) {
      const errorBody = await response.text().catch((error) => `Failed to read error body: ${(error as Error).message}`)

      if (
        isTransientModelLoadingError(response.status, destinationPath, errorBody) &&
        modelLoadAttempts < MODEL_LOAD_RETRY_ATTEMPTS
      ) {
        modelLoadAttempts += 1
        console.log(
          `[proxy] Upstream model is still loading for ${destinationPath}; retrying ${modelLoadAttempts}/${MODEL_LOAD_RETRY_ATTEMPTS}`
        )
        await new Promise((resolve) => setTimeout(resolve, MODEL_LOAD_RETRY_DELAY_MS))
        continue
      }

      console.error(
        `[proxy] Upstream provider returned ${response.status} for ${destinationPath} (${errorBody.length} bytes)`
      )
      cleanupStream()
      respond(res, response.status, errorBody, hostHeader, originHeader, config)
      return
    }

    // Success — stream the response back. SSE responses get line-level patching.
    const upstreamHeaders: Record<string, string> = {}
    response.headers.forEach((value, name) => {
      const lower = name.toLowerCase()
      // content-encoding is dropped: undici already decompressed the body, so
      // forwarding it would make the client decode twice. content-length no
      // longer matches the (possibly patched) body for the same reason.
      if (isCorsHeader(lower) || lower === 'content-length' || lower === 'content-encoding') return
      if (HOP_BY_HOP_HEADERS.has(lower)) return
      upstreamHeaders[name] = value
    })

    const contentType = response.headers.get('content-type') ?? '<unknown>'
    console.log(`[proxy] Upstream response: status=${response.status} content-type=${contentType}`)

    res.writeHead(response.status, {
      ...upstreamHeaders,
      ...corsResponseHeaders(hostHeader, originHeader, config),
    })

    const isSse = contentType.includes('text/event-stream')
    const bodyStream = response.body !== null ? Readable.fromWeb(response.body as import('node:stream/web').ReadableStream) : null

    if (bodyStream === null) {
      cleanupStream()
      res.end()
      return
    }

    try {
      if (!isSse) {
        for await (const chunk of bodyStream) {
          if (!res.write(chunk as Buffer)) {
            await new Promise((resolve) => res.once('drain', resolve))
          }
        }
      } else {
        const decoder = new StringDecoder('utf8')
        let lineBuffer = ''
        let bufferOverflow = false
        for await (const chunk of bodyStream) {
          lineBuffer += decoder.write(chunk as Buffer)
          if (lineBuffer.length > MAX_SSE_LINE_BUFFER) {
            console.error(`[proxy] SSE line buffer exceeded ${MAX_SSE_LINE_BUFFER} bytes, aborting stream`)
            bufferOverflow = true
            break
          }
          let newlineIndex: number
          while ((newlineIndex = lineBuffer.indexOf('\n')) !== -1) {
            const line = lineBuffer.slice(0, newlineIndex + 1)
            lineBuffer = lineBuffer.slice(newlineIndex + 1)
            if (!res.write(patchSseLine(line))) {
              await new Promise((resolve) => res.once('drain', resolve))
            }
          }
        }
        if (!bufferOverflow) {
          lineBuffer += decoder.end()
          if (lineBuffer.length > 0) res.write(patchSseLine(lineBuffer))
        }
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        console.error(`[proxy] Stream error: ${(error as Error).message}`)
      }
    } finally {
      cleanupStream()
      if (!res.writableEnded) res.end()
    }
    return
  }
}

// ─── Top-level request handler (proxy.rs proxy_request) ─────────────────────

const MODEL_POST_ROUTES = new Set([
  '/chat/completions',
  '/completions',
  '/embeddings',
  '/messages/count_tokens',
])

function readRequestBody(req: http.IncomingMessage, maxSize: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > maxSize) {
        reject(new Error('__too_large__'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: ProxyConfig,
  connectTimeoutMs: number
): Promise<void> {
  try {
    if (handleCorsPreflight(req, res, config)) return

    const hostHeader = firstHeader(req.headers.host)
    const originHeader = firstHeader(req.headers.origin)
    const requestPath = (req.url ?? '/').split('?')[0]
    const path = removePrefix(requestPath, config.prefix)
    const clientId = req.socket.remoteAddress ?? 'unknown'

    if (config.verboseLogs) {
      console.log(`[proxy] Local API request: ${req.method} ${path}`)
    }

    if (!validateRequest(path, hostHeader, originHeader, req.headers, config, clientId, res)) {
      return
    }

    if (req.method === 'GET' && path === '/models') {
      handleModelsRoute(hostHeader, originHeader, config, res)
      return
    }

    if (req.method === 'POST' && MODEL_POST_ROUTES.has(path)) {
      let body: Buffer
      try {
        body = await readRequestBody(req, MAX_MODEL_REQUEST_BODY_SIZE)
      } catch (error) {
        const tooLarge = (error as Error).message === '__too_large__'
        respond(
          res,
          tooLarge ? 413 : 400,
          tooLarge
            ? `Request body exceeds ${MAX_MODEL_REQUEST_BODY_SIZE / 1024 / 1024} MB limit`
            : 'Failed to read request body',
          hostHeader,
          originHeader,
          config
        )
        return
      }

      const providerHintHeader = firstHeader(req.headers['x-ax-provider'])
      const providerHint = providerHintHeader.length > 0 ? providerHintHeader : null
      const outcome = resolveModelRoute(path, body, providerHint)
      if ('error' in outcome) {
        respond(res, outcome.error.status, outcome.error.message, hostHeader, originHeader, config)
        return
      }
      await dispatchToUpstream(
        outcome.resolution,
        path,
        req.headers,
        hostHeader,
        originHeader,
        config,
        connectTimeoutMs,
        res
      )
      return
    }

    console.warn(`[proxy] Unhandled method/path for dynamic routing: ${req.method} ${path}`)
    respond(res, 404, 'Not Found', hostHeader, originHeader, config)
  } catch (error) {
    console.error(`[proxy] Unhandled request error: ${(error as Error).message}`)
    respond(res, 500, 'Internal proxy error', '', '', config)
  }
}

// ─── Server lifecycle (proxy_server.rs) ─────────────────────────────────────

interface RunningServer {
  server: http.Server
  config: ProxyConfig
}

let runningServer: RunningServer | null = null

export function isServerRunning(): boolean {
  return runningServer !== null
}

export function startProxyServer(
  host: string,
  port: number,
  config: ProxyConfig,
  proxyTimeoutSecs: number
): Promise<number> {
  if (runningServer !== null) {
    return Promise.reject(new Error('Server is already running'))
  }
  const connectTimeoutMs = Math.min(proxyTimeoutSecs, 30) * 1000

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      void handleRequest(req, res, config, connectTimeoutMs)
    })
    server.on('error', (error) => {
      console.error(`[proxy] Failed to bind to ${host}:${port}: ${error.message}`)
      runningServer = null
      reject(new Error(`Failed to bind to ${host}:${port}: ${error.message}`))
    })
    server.listen(port, host, () => {
      const address = server.address()
      const actualPort = typeof address === 'object' && address !== null ? address.port : port
      runningServer = { server, config }
      console.log(`[proxy] AX Studio API server started on http://${host}:${actualPort}`)
      resolve(actualPort)
    })
  })
}

export async function stopProxyServer(): Promise<void> {
  const current = runningServer
  runningServer = null
  if (!current) return

  await new Promise<void>((resolve) => {
    const forceTimer = setTimeout(() => {
      console.warn('[proxy] Graceful server shutdown timed out, closing connections')
      current.server.closeAllConnections()
    }, 2_000)
    current.server.close(() => {
      clearTimeout(forceTimer)
      resolve()
    })
    // close() only fires once idle; make sure keep-alive sockets do not hang it.
    current.server.closeIdleConnections()
  })
  console.log('[proxy] AX Studio API server stopped')
}
