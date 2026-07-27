const DEFAULT_BASE_URL = 'http://127.0.0.1:31418/v1'
const DEFAULT_API_KEY = 'local'

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::1'
  ) {
    return true
  }
  const octets = normalized.split('.').map(Number)
  return (
    octets.length === 4 &&
    octets.every(
      (octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255
    ) &&
    octets[0] === 127
  )
}

export function normalizeAxEngineAttachBaseURL(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('AX Engine endpoint is required')
  if (trimmed.length > 2_048) throw new Error('AX Engine endpoint is too long')
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`
  const url = new URL(withProtocol)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('AX Engine endpoint must use http:// or https://')
  }
  if (url.username || url.password) {
    throw new Error('AX Engine endpoint must not contain embedded credentials')
  }
  if (url.search || url.hash) {
    throw new Error(
      'AX Engine endpoint must not contain a query string or fragment'
    )
  }
  if (!isLoopbackHostname(url.hostname)) {
    throw new Error(
      'AX Engine endpoint must use localhost or a 127.0.0.0/8 loopback address'
    )
  }
  const normalized = `${url.protocol}//${url.host}${url.pathname}`.replace(
    /\/+$/,
    ''
  )
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`
}

type ModelCard = {
  id?: unknown
  capabilities?: { toolcall?: unknown }
  ax_engine?: { openai_tool_calling_supported?: unknown }
}

export type AxEngineConnectionProbeResult = {
  baseURL: string
  models: string[]
  toolcall: boolean
}

export async function probeAxEngineConnection(input: {
  baseURL?: string
  apiKey?: string
  timeoutMs?: number
}): Promise<AxEngineConnectionProbeResult> {
  const baseURL = normalizeAxEngineAttachBaseURL(
    input.baseURL ?? DEFAULT_BASE_URL
  )
  const apiKey = input.apiKey?.trim() || DEFAULT_API_KEY
  if (apiKey.includes('\0') || Buffer.byteLength(apiKey, 'utf8') > 16_384) {
    throw new Error('AX Engine API key is invalid or too large')
  }
  const response = await fetch(`${baseURL}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(input.timeoutMs ?? 5_000),
    redirect: 'error',
  })
  if (!response.ok) {
    response.body?.cancel()
    throw new Error(`AX Engine /v1/models returned HTTP ${response.status}`)
  }
  const payload = (await response.json()) as { data?: unknown }
  const cards = Array.isArray(payload.data) ? (payload.data as ModelCard[]) : []
  const valid = cards.filter(
    (card): card is ModelCard & { id: string } =>
      typeof card?.id === 'string' && card.id.trim().length > 0
  )
  if (valid.length === 0) {
    throw new Error('AX Engine /v1/models returned no valid model cards')
  }
  const toolcallModels = valid.filter(
    (card) =>
      card.ax_engine?.openai_tool_calling_supported === true ||
      card.capabilities?.toolcall === true
  )
  if (toolcallModels.length === 0) {
    throw new Error(
      'Attached AX Engine has no model with OpenAI structured tool calling'
    )
  }
  return {
    baseURL,
    models: toolcallModels.map((card) => card.id),
    toolcall: true,
  }
}
