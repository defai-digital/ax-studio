/**
 * Ax-Studio llama.cpp Extension — Utility Functions
 *
 * Written from scratch for Ax-Studio (UNLICENSED).
 */

export interface ProxyConfig {
  host: string
  port: number
  user?: string
  password?: string
  https?: boolean
  noVerify?: boolean
}

/**
 * Extract a filename without its extension.
 * Handles compound extensions (.tar.gz, .tar.bz2) and single extensions.
 */
export function basenameNoExt(filePath: string): string {
  const name = filePath.includes('/') ? filePath.split('/').pop()! : filePath
  const COMPOUND_EXTENSIONS = ['.tar.gz', '.tar.bz2', '.tar.xz']
  for (const ext of COMPOUND_EXTENSIONS) {
    if (name.endsWith(ext)) return name.slice(0, -ext.length)
  }
  const lastDot = name.lastIndexOf('.')
  return lastDot >= 0 ? name.slice(0, lastDot) : name
}

/**
 * Read proxy configuration from localStorage.
 * Returns null if proxy is disabled or not configured.
 */
export function getProxyConfig(): ProxyConfig | null {
  try {
    const raw = localStorage.getItem('setting-proxy-config')
    if (!raw) return null
    const config = JSON.parse(raw)
    if (!config || !config.enabled || !config.host) return null
    return {
      host: config.host,
      port: Number(config.port) || 8080,
      user: config.user,
      password: config.password,
      https: Boolean(config.https),
      noVerify: Boolean(config.noVerify),
    }
  } catch {
    return null
  }
}

/**
 * Build a proxy argument object compatible with the Rust ProxyConfig struct.
 *
 * Rust expects: { url: string, username?: string, password?: string, ignore_ssl?: bool }
 * Returns null when no proxy is configured so the caller can omit the field
 * entirely (sending {} to Rust would fail serde deserialization of Option<ProxyConfig>).
 */
export function buildProxyArg(
  proxy: ProxyConfig | null
): Record<string, string | boolean> | null {
  if (!proxy) return null
  const scheme = proxy.https ? 'https' : 'http'
  const result: Record<string, string | boolean> = {
    url: `${scheme}://${proxy.host}:${proxy.port}`,
  }
  if (proxy.user) result.username = proxy.user
  if (proxy.password) result.password = proxy.password
  if (proxy.noVerify) result.ignore_ssl = true
  return result
}

/**
 * Rough token count estimate based on character count.
 * Used only for batching decisions, not for accuracy.
 */
export function estimateTokensFromText(text: string, charsPerToken = 3): number {
  return Math.ceil(text.length / charsPerToken)
}

export interface EmbedBatch {
  inputs: string[]
  startIndex: number
}

export interface EmbedBatchResult {
  data: Array<{ embedding: number[]; index: number; object: string }>
  usage: { prompt_tokens: number; total_tokens: number }
}

export interface EmbeddingResponse {
  model: string
  object: string
  usage: { prompt_tokens: number; total_tokens: number }
  data: Array<{ embedding: number[]; index: number; object: string }>
}

/**
 * Group embedding inputs into batches that fit within ubatch_size.
 * Uses a 50% safety margin to avoid OOM.
 */
export function buildEmbedBatches(inputs: string[], ubatchSize: number): EmbedBatch[] {
  const safeLimit = Math.max(1, Math.floor(ubatchSize * 0.5))
  const batches: EmbedBatch[] = []
  let currentBatch: string[] = []
  let currentTokens = 0
  let batchStartIndex = 0

  for (let i = 0; i < inputs.length; i++) {
    const tokens = estimateTokensFromText(inputs[i])
    if (currentBatch.length > 0 && currentTokens + tokens > safeLimit) {
      batches.push({ inputs: currentBatch, startIndex: batchStartIndex })
      batchStartIndex = i
      currentBatch = []
      currentTokens = 0
    }
    currentBatch.push(inputs[i])
    currentTokens += tokens
  }

  if (currentBatch.length > 0) {
    batches.push({ inputs: currentBatch, startIndex: batchStartIndex })
  }
  return batches
}

/**
 * Merge multiple embedding batch results into a single response.
 * Re-indexes the results sequentially from 0.
 */
export function mergeEmbedResponses(
  model: string,
  batchResults: EmbedBatchResult[]
): EmbeddingResponse {
  let totalPromptTokens = 0
  let totalTokens = 0
  const data: Array<{ embedding: number[]; index: number; object: string }> = []

  for (const result of batchResults) {
    totalPromptTokens += result.usage?.prompt_tokens ?? 0
    totalTokens += result.usage?.total_tokens ?? 0
    for (const item of result.data ?? []) {
      data.push({ ...item, index: data.length })
    }
  }

  return {
    model,
    object: 'list',
    usage: { prompt_tokens: totalPromptTokens, total_tokens: totalTokens },
    data,
  }
}

/**
 * Parse a simple YAML key-value file into a plain object.
 * Only handles scalar values (string, number, boolean).
 */
export function parseSimpleYaml(content: string): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx < 0) continue
    const key = trimmed.slice(0, colonIdx).trim()
    const rawValue = trimmed.slice(colonIdx + 1).trim()
    if (
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
    ) {
      result[key] = rawValue.slice(1, -1)
    } else if (rawValue === 'true') {
      result[key] = true
    } else if (rawValue === 'false') {
      result[key] = false
    } else if (rawValue !== '' && !isNaN(Number(rawValue))) {
      result[key] = Number(rawValue)
    } else {
      result[key] = rawValue
    }
  }
  return result
}

/**
 * Serialize a plain object to a simple YAML string.
 * Only handles scalar values.
 */
export function toSimpleYaml(
  obj: Record<string, string | number | boolean | undefined>
): string {
  return (
    Object.entries(obj)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => {
        if (typeof v === 'string') return `${k}: "${v}"`
        return `${k}: ${v}`
      })
      .join('\n') + '\n'
  )
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
