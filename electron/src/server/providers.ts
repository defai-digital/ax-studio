// Remote provider configuration registry (Node port of
// src-tauri/src/core/server/remote_provider_commands.rs and the ProviderConfig
// validation in src-tauri/src/core/state.rs). Provider credentials live only
// here in the main process; the proxy injects them into upstream requests.
import dns from 'node:dns/promises'
import net from 'node:net'
import { isInternalUrl, isPrivateIp } from './network.js'

export interface ProviderCustomHeader {
  header: string
  value: string
}

export interface ProviderConfig {
  provider: string
  api_key: string | null
  base_url: string | null
  custom_headers: ProviderCustomHeader[]
  models: string[]
}

/** Redacted view returned by list_provider_configs (mirrors ProviderConfigView). */
export interface ProviderConfigView {
  provider: string
  has_api_key: boolean
  base_url: string | null
  custom_headers: Array<{ header: string }>
  models: string[]
}

export interface RegisterProviderRequest {
  provider: string
  api_key?: string | null
  base_url?: string | null
  custom_headers?: ProviderCustomHeader[]
  models?: string[]
}

const MAX_PROVIDER_BATCH_SIZE = 64
const PROVIDER_DNS_TIMEOUT_MS = 5_000

const MAX_PROVIDER_NAME_BYTES = 128
const MAX_PROVIDER_URL_BYTES = 4 * 1024
const MAX_PROVIDER_SECRET_BYTES = 16 * 1024
const MAX_PROVIDER_HEADERS = 64
const MAX_HEADER_NAME_BYTES = 256
const MAX_HEADER_VALUE_BYTES = 16 * 1024
const MAX_PROVIDER_MODELS = 4_096
const MAX_MODEL_NAME_BYTES = 512

// Providers that legitimately point to loopback/internal URLs.
const INTERNAL_NETWORK_PROVIDERS = new Set(['llamacpp', 'ollama', 'lmstudio', 'mlx', 'ax-engine'])

export function providerAllowsInternalNetwork(provider: string): boolean {
  return INTERNAL_NETWORK_PROVIDERS.has(provider)
}

// ─── In-process provider state (AppState.provider_state / active_streams) ───

export const providerConfigs = new Map<string, ProviderConfig>()
export let providerModelIndex = new Map<string, string[]>()

export function syncModelIndex(): void {
  const index = new Map<string, string[]>()
  for (const config of providerConfigs.values()) {
    for (const model of config.models) {
      const providers = index.get(model)
      if (providers) providers.push(config.provider)
      else index.set(model, [config.provider])
    }
  }
  providerModelIndex = index
}

/** Stream-id → abort handle for abort_remote_stream (AppState.active_streams). */
export const activeStreams = new Map<string, { abort: () => void }>()

// ─── Validation ─────────────────────────────────────────────────────────────

function hasControlChars(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f]/.test(value)
}

function isValidHeaderName(name: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)
}

function isValidHeaderValue(value: string): boolean {
  // RFC 7230 field-content: no NUL/CR/LF; obs-text allowed.
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u0008\u000a-\u001f\u007f]/.test(value)
}

function isReservedProviderHeader(name: string): boolean {
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

function validateProviderConfig(config: ProviderConfig): void {
  const nameBytes = Buffer.byteLength(config.provider, 'utf8')
  if (config.provider.trim().length === 0 || nameBytes > MAX_PROVIDER_NAME_BYTES || hasControlChars(config.provider)) {
    throw new Error(
      `Provider name must contain between 1 and ${MAX_PROVIDER_NAME_BYTES} non-control bytes`
    )
  }
  if (
    config.api_key !== null &&
    (Buffer.byteLength(config.api_key, 'utf8') > MAX_PROVIDER_SECRET_BYTES || config.api_key.includes('\0'))
  ) {
    throw new Error(
      `Provider API key exceeds the ${MAX_PROVIDER_SECRET_BYTES}-byte limit or contains NUL`
    )
  }
  if (config.base_url !== null) {
    if (Buffer.byteLength(config.base_url, 'utf8') > MAX_PROVIDER_URL_BYTES || hasControlChars(config.base_url)) {
      throw new Error(
        `Provider URL exceeds the ${MAX_PROVIDER_URL_BYTES}-byte limit or contains control characters`
      )
    }
    if (config.base_url.trim().length > 0) {
      try {
        new URL(config.base_url)
      } catch {
        throw new Error(`Invalid base_url for provider '${config.provider}': ${config.base_url}`)
      }
    }
  }
  if (config.custom_headers.length > MAX_PROVIDER_HEADERS) {
    throw new Error(`Provider has more than ${MAX_PROVIDER_HEADERS} custom headers`)
  }
  const headerNames = new Set<string>()
  for (const header of config.custom_headers) {
    if (
      header.header.length === 0 ||
      Buffer.byteLength(header.header, 'utf8') > MAX_HEADER_NAME_BYTES ||
      Buffer.byteLength(header.value, 'utf8') > MAX_HEADER_VALUE_BYTES ||
      !isValidHeaderName(header.header) ||
      !isValidHeaderValue(header.value)
    ) {
      throw new Error('Provider contains an invalid custom header')
    }
    const normalized = header.header.toLowerCase()
    if (isReservedProviderHeader(normalized)) {
      throw new Error(`Provider custom header '${header.header}' is reserved`)
    }
    if (headerNames.has(normalized)) {
      throw new Error('Provider contains duplicate custom header names')
    }
    headerNames.add(normalized)
  }
  if (config.models.length > MAX_PROVIDER_MODELS) {
    throw new Error(`Provider has more than ${MAX_PROVIDER_MODELS} models`)
  }
  const modelNames = new Set<string>()
  for (const model of config.models) {
    if (model.trim().length === 0 || Buffer.byteLength(model, 'utf8') > MAX_MODEL_NAME_BYTES || hasControlChars(model)) {
      throw new Error(
        `Model names must contain between 1 and ${MAX_MODEL_NAME_BYTES} non-control bytes`
      )
    }
    if (modelNames.has(model)) {
      throw new Error('Provider contains duplicate model names')
    }
    modelNames.add(model)
  }
}

/** Strip an optional "Bearer " prefix and surrounding whitespace (Rust normalize_provider_api_key). */
export function normalizeProviderApiKey(apiKey: string | null | undefined): string | null {
  if (apiKey === null || apiKey === undefined) return null
  const trimmed = apiKey.trim()
  if (trimmed.length === 0) return null
  const match = trimmed.match(/^(\S+)(?:\s+(.*))?$/)
  if (match && match[1].toLowerCase() === 'bearer' && match[2]) {
    const rest = match[2].trim()
    if (rest.length > 0) return rest
  }
  return trimmed
}

function providerIpIsForbidden(ip: string, allowInternal: boolean): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 0) return true // unspecified 0.0.0.0/8
    if (a === 169 && b === 254) return true // link-local
    if (a >= 224) return true // multicast / reserved
    return !allowInternal && isPrivateIp(ip)
  }
  if (net.isIPv6(ip)) {
    if (ip === '::') return true
    if (ip.toLowerCase().startsWith('fe8') || ip.toLowerCase().startsWith('fe9') ||
        ip.toLowerCase().startsWith('fea') || ip.toLowerCase().startsWith('feb')) return true // fe80::/10
    if (ip.toLowerCase().startsWith('ff')) return true // multicast
    return !allowInternal && isPrivateIp(ip)
  }
  return true
}

/** Registration-time SSRF guard (Rust validate_provider_url). */
export async function validateProviderUrl(provider: string, rawUrl: string): Promise<void> {
  const allowInternal = providerAllowsInternalNetwork(provider)
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch (error) {
    throw new Error(`Invalid provider URL '${rawUrl}': ${(error as Error).message}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Provider URL scheme must be http or https, got '${parsed.protocol.slice(0, -1)}'`)
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new Error('Provider URL must not contain embedded credentials')
  }
  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new Error('Provider URL must not contain a query string or fragment')
  }
  if (!allowInternal && isInternalUrl(rawUrl)) {
    throw new Error('Provider URL must not point to an internal or private address')
  }
  const host = parsed.hostname
  if (host.length === 0) {
    throw new Error(`Provider URL has no host: ${rawUrl}`)
  }
  if (net.isIP(host)) {
    if (providerIpIsForbidden(host, allowInternal)) {
      throw new Error(`Provider URL must not point to a forbidden address (got ${host})`)
    }
    return
  }
  // Domain: resolve and check every answer (5s timeout, mirroring Rust).
  let addresses: Array<{ address: string }>
  try {
    addresses = await Promise.race([
      dns.lookup(host, { all: true }),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('__timeout__')), PROVIDER_DNS_TIMEOUT_MS)
      ),
    ])
  } catch (error) {
    if ((error as Error).message === '__timeout__') {
      throw new Error(`Timed out resolving provider URL host '${host}'`)
    }
    throw new Error(`Failed to resolve provider URL host '${host}': ${(error as Error).message}`)
  }
  if (addresses.length === 0) {
    throw new Error(`Provider URL host '${host}' did not resolve to any addresses`)
  }
  for (const { address } of addresses) {
    if (providerIpIsForbidden(address, allowInternal)) {
      throw new Error('Provider URL must not resolve to a forbidden address')
    }
  }
}

async function validateProviderRequest(request: RegisterProviderRequest): Promise<[string, ProviderConfig]> {
  const provider = (request.provider ?? '').trim()
  const baseUrlRaw = request.base_url
  const baseUrl =
    typeof baseUrlRaw === 'string' && baseUrlRaw.trim().length > 0 ? baseUrlRaw.trim() : null
  if (baseUrl !== null) {
    await validateProviderUrl(provider, baseUrl)
  }
  const config: ProviderConfig = {
    provider,
    api_key: normalizeProviderApiKey(request.api_key),
    base_url: baseUrl,
    custom_headers: Array.isArray(request.custom_headers) ? request.custom_headers : [],
    models: Array.isArray(request.models) ? request.models : [],
  }
  validateProviderConfig(config)
  return [provider, config]
}

// ─── Command-facing operations ──────────────────────────────────────────────

export async function registerProviderConfig(request: RegisterProviderRequest): Promise<void> {
  const [providerName, config] = await validateProviderRequest(request)
  providerConfigs.set(providerName, config)
  syncModelIndex()
  console.log(`[proxy] Registered provider config: ${providerName}`)
}

export async function registerProviderConfigsBatch(requests: RegisterProviderRequest[]): Promise<void> {
  if (requests.length > MAX_PROVIDER_BATCH_SIZE) {
    throw new Error(`Provider batch exceeds the ${MAX_PROVIDER_BATCH_SIZE}-item limit`)
  }
  // Validate the whole batch (including DNS) before mutating shared state so a
  // single invalid item cannot leave a partial batch.
  const configs: Array<[string, ProviderConfig]> = []
  for (const request of requests) {
    configs.push(await validateProviderRequest(request))
  }
  for (const [providerName, config] of configs) {
    console.log(
      `[proxy] Registered provider config (batch): ${providerName} has_key=${config.api_key !== null} models_count=${config.models.length}`
    )
    providerConfigs.set(providerName, config)
  }
  syncModelIndex()
}

export function unregisterProviderConfig(provider: string): void {
  if (provider.trim().length === 0 || provider.length > 128 || hasControlChars(provider)) {
    throw new Error('Invalid provider name')
  }
  if (providerConfigs.delete(provider)) {
    syncModelIndex()
    console.log(`[proxy] Unregistered provider config: ${provider}`)
  } else {
    console.warn(`[proxy] Provider config not found: ${provider}`)
  }
}

export function listProviderConfigs(): ProviderConfigView[] {
  return [...providerConfigs.values()].map((config) => ({
    provider: config.provider,
    has_api_key: config.api_key !== null && config.api_key.length > 0,
    base_url: config.base_url,
    custom_headers: config.custom_headers.map((header) => ({ header: header.header })),
    models: config.models,
  }))
}

export function abortRemoteStream(streamId: string): void {
  if (streamId.length === 0 || streamId.length > 256 || hasControlChars(streamId)) {
    throw new Error('Invalid stream identifier')
  }
  const handle = activeStreams.get(streamId)
  if (handle) {
    activeStreams.delete(streamId)
    handle.abort()
    console.log(`[proxy] Stream ${streamId} abort signal sent`)
  }
}
