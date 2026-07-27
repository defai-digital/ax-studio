import {
  AX_ENGINE_SIDECAR_DEFAULT_API_KEY,
  AX_ENGINE_SIDECAR_DEFAULT_BASE_URL,
} from '@/constants/providers'
import {
  AX_ENGINE_ATTACH_API_KEY_SECRET,
  deleteSecureSecret,
  getSecureSecret,
  setSecureSecret,
} from '@/lib/storage/secure-secret'
import { invoke } from '@/lib/tauri-shim/api-core'

export type AxEngineConnectionMode = 'managed' | 'attach'

export { AX_ENGINE_ATTACH_API_KEY_SECRET }

export type AxEngineConnectionProbe = {
  baseURL: string
  models: string[]
  toolcall: boolean
}

export function getAxEngineConnectionMode(
  provider?: Pick<ModelProvider, 'connection_mode'>
): AxEngineConnectionMode {
  return provider?.connection_mode === 'attach' ? 'attach' : 'managed'
}

export function normalizeAxEngineAttachBaseURL(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('AX Engine endpoint is required.')
  if (trimmed.length > 2_048) {
    throw new Error('AX Engine endpoint is too long.')
  }
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`
  const url = new URL(withProtocol)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('AX Engine endpoint must use http:// or https://.')
  }
  if (url.username || url.password) {
    throw new Error('AX Engine endpoint must not include credentials.')
  }
  if (url.search || url.hash) {
    throw new Error(
      'AX Engine endpoint must not include a query string or fragment.'
    )
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const octets = hostname.split('.').map(Number)
  const loopback =
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '::1' ||
    (octets.length === 4 &&
      octets[0] === 127 &&
      octets.every(
        (octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255
      ))
  if (!loopback) {
    throw new Error(
      'AX Engine endpoint must use localhost or a 127.0.0.0/8 loopback address.'
    )
  }
  const normalized = `${url.protocol}//${url.host}${url.pathname}`.replace(
    /\/+$/,
    ''
  )
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`
}

function comparableAxEngineHostname(hostname: string): string {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::1' ||
    normalized === '127.0.0.1'
  ) {
    return 'default-loopback'
  }
  return normalized
}

/** Conservatively detect aliases for the same local listener. */
export function axEngineEndpointsMayAlias(
  left: string,
  right: string
): boolean {
  const first = new URL(normalizeAxEngineAttachBaseURL(left))
  const second = new URL(normalizeAxEngineAttachBaseURL(right))
  return (
    first.protocol === second.protocol &&
    first.port === second.port &&
    first.pathname === second.pathname &&
    comparableAxEngineHostname(first.hostname) ===
      comparableAxEngineHostname(second.hostname)
  )
}

function normalizeAxEngineApiKey(
  value: string | null | undefined
): string | null {
  const apiKey = value?.trim()
  if (!apiKey) return null
  if (
    apiKey.includes('\0') ||
    new TextEncoder().encode(apiKey).length > 16_384
  ) {
    throw new Error('AX Engine API key is invalid or too large.')
  }
  return apiKey
}

export async function readAxEngineAttachApiKey(): Promise<string | null> {
  const value = await getSecureSecret(AX_ENGINE_ATTACH_API_KEY_SECRET)
  return normalizeAxEngineApiKey(value)
}

export async function storeAxEngineAttachApiKey(
  value: string
): Promise<string> {
  const apiKey =
    normalizeAxEngineApiKey(value) ?? AX_ENGINE_SIDECAR_DEFAULT_API_KEY
  await setSecureSecret(AX_ENGINE_ATTACH_API_KEY_SECRET, apiKey)
  return apiKey
}

export async function clearAxEngineAttachApiKey(): Promise<void> {
  await deleteSecureSecret(AX_ENGINE_ATTACH_API_KEY_SECRET)
}

export async function probeAxEngineConnection(input: {
  baseURL?: string
  apiKey?: string
}): Promise<AxEngineConnectionProbe> {
  const baseURL = normalizeAxEngineAttachBaseURL(
    input.baseURL ?? AX_ENGINE_SIDECAR_DEFAULT_BASE_URL
  )
  const apiKey =
    normalizeAxEngineApiKey(input.apiKey) ||
    (await readAxEngineAttachApiKey()) ||
    AX_ENGINE_SIDECAR_DEFAULT_API_KEY
  return invoke<AxEngineConnectionProbe>('ax_engine_probe', {
    baseURL,
    apiKey,
  })
}
