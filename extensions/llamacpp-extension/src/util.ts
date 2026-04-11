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
function basenameNoExt(filePath: string): string {
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
  const auth =
    proxy.user || proxy.password
      ? `${encodeURIComponent(proxy.user ?? '')}:${encodeURIComponent(proxy.password ?? '')}@`
      : ''
  const result: Record<string, string | boolean> = {
    url: `${scheme}://${auth}${proxy.host}:${proxy.port}`,
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

// Leave half the ubatch budget unused to reduce GPU/CPU memory spikes while batching embeddings.
const EMBED_BATCH_SAFETY_MARGIN = 0.5

/**
 * Group embedding inputs into batches that fit within ubatch_size.
 * Uses a 50% safety margin to avoid OOM.
 */
export function buildEmbedBatches(inputs: string[], ubatchSize: number): EmbedBatch[] {
  const safeLimit = Math.max(1, Math.floor(ubatchSize * EMBED_BATCH_SAFETY_MARGIN))
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

type YamlValue =
  | string
  | number
  | boolean
  | null
  | YamlValue[]
  | { [key: string]: YamlValue }

const countIndent = (line: string): number => {
  const match = line.match(/^ */)
  return match ? match[0].length : 0
}

const stripInlineComment = (value: string): string => {
  let inSingle = false
  let inDouble = false

  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    const prev = i > 0 ? value[i - 1] : ''
    if (char === "'" && !inDouble && prev !== '\\') inSingle = !inSingle
    if (char === '"' && !inSingle && prev !== '\\') inDouble = !inDouble
    if (char === '#' && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(value[i - 1])) return value.slice(0, i).trimEnd()
    }
  }

  return value.trimEnd()
}

const parseScalar = (rawValue: string): YamlValue => {
  const value = stripInlineComment(rawValue).trim()
  if (value === '') return ''
  if (value === 'null' || value === '~') return null
  if (value === 'true') return true
  if (value === 'false') return false
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n')
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    // YAML single-quoted strings only escape '' (two single quotes → one)
    return value.slice(1, -1).replace(/''/g, "'")
  }
  if (!Number.isNaN(Number(value))) return Number(value)
  if (value === '[]') return []
  if (value === '{}') return {}
  return value
}

const splitKeyValue = (line: string): [string, string] | null => {
  let inSingle = false
  let inDouble = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const prev = i > 0 ? line[i - 1] : ''
    if (char === "'" && !inDouble && prev !== '\\') inSingle = !inSingle
    if (char === '"' && !inSingle && prev !== '\\') inDouble = !inDouble
    if (char === ':' && !inSingle && !inDouble) {
      const key = line.slice(0, i).trim()
      const value = line.slice(i + 1)
      return key ? [key, value] : null
    }
  }

  return null
}

const serializeScalar = (value: string | number | boolean | null): string => {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}

const parseYamlBlock = (
  lines: string[],
  indexRef: { index: number },
  indent: number
): YamlValue => {
  if (indexRef.index >= lines.length) return ''

  const currentLine = lines[indexRef.index]
  const currentTrimmed = currentLine.slice(indent).trim()

  if (currentTrimmed.startsWith('- ')) {
    const result: YamlValue[] = []

    while (indexRef.index < lines.length) {
      const line = lines[indexRef.index]
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) {
        indexRef.index += 1
        continue
      }

      const lineIndent = countIndent(line)
      if (lineIndent < indent) break
      if (lineIndent !== indent || !line.slice(indent).startsWith('- ')) break

      const remainder = line.slice(indent + 2).trim()
      if (!remainder) {
        indexRef.index += 1
        result.push(parseYamlBlock(lines, indexRef, indent + 2))
        continue
      }

      const inlineKeyValue = splitKeyValue(remainder)
      if (inlineKeyValue) {
        const [key, rawValue] = inlineKeyValue
        const item: Record<string, YamlValue> = {}
        item[key] = parseScalar(rawValue)
        indexRef.index += 1

        while (indexRef.index < lines.length) {
          const nextLine = lines[indexRef.index]
          const nextTrimmed = nextLine.trim()
          if (!nextTrimmed || nextTrimmed.startsWith('#')) {
            indexRef.index += 1
            continue
          }

          const nextIndent = countIndent(nextLine)
          if (nextIndent <= indent) break
          const nested = splitKeyValue(nextLine.trim())
          if (!nested) break
          const [nestedKey, nestedValue] = nested
          if (stripInlineComment(nestedValue).trim() === '|') {
            indexRef.index += 1
            const blockLines: string[] = []
            while (indexRef.index < lines.length) {
              const blockLine = lines[indexRef.index]
              const blockIndent = countIndent(blockLine)
              if (blockIndent <= nextIndent) break
              blockLines.push(blockLine.slice(nextIndent + 2))
              indexRef.index += 1
            }
            item[nestedKey] = blockLines.join('\n')
            continue
          }
          item[nestedKey] = parseScalar(nestedValue)
          indexRef.index += 1
        }

        result.push(item)
        continue
      }

      result.push(parseScalar(remainder))
      indexRef.index += 1
    }

    return result
  }

  const result: Record<string, YamlValue> = {}
  while (indexRef.index < lines.length) {
    const line = lines[indexRef.index]
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      indexRef.index += 1
      continue
    }

    const lineIndent = countIndent(line)
    if (lineIndent < indent) break
    if (lineIndent > indent) {
      indexRef.index += 1
      continue
    }

    const keyValue = splitKeyValue(line.slice(indent))
    if (!keyValue) {
      indexRef.index += 1
      continue
    }

    const [key, rawValue] = keyValue
    const value = stripInlineComment(rawValue).trim()

    if (value === '|') {
      indexRef.index += 1
      const blockLines: string[] = []
      while (indexRef.index < lines.length) {
        const blockLine = lines[indexRef.index]
        const blockIndent = countIndent(blockLine)
        if (blockLine.trim() && blockIndent <= indent) break
        if (!blockLine.trim()) {
          blockLines.push('')
        } else {
          blockLines.push(blockLine.slice(indent + 2))
        }
        indexRef.index += 1
      }
      result[key] = blockLines.join('\n')
      continue
    }

    if (value === '') {
      indexRef.index += 1
      result[key] = parseYamlBlock(lines, indexRef, indent + 2)
      continue
    }

    result[key] = parseScalar(value)
    indexRef.index += 1
  }

  return result
}

export function parseSimpleYaml(content: string): Record<string, YamlValue> {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const indexRef = { index: 0 }
  const parsed = parseYamlBlock(lines, indexRef, 0)
  return Array.isArray(parsed)
    ? { items: parsed }
    : (parsed as Record<string, YamlValue>)
}

const serializeYamlValue = (value: YamlValue, indent = 0): string[] => {
  const prefix = ' '.repeat(indent)

  if (Array.isArray(value)) {
    if (value.length === 0) return [`${prefix}[]`]
    return value.flatMap((item: YamlValue) => {
      if (
        item === null ||
        typeof item === 'string' ||
        typeof item === 'number' ||
        typeof item === 'boolean'
      ) {
        return [`${prefix}- ${serializeScalar(item)}`]
      }

      const nested = serializeYamlValue(item, indent + 2)
      return [`${prefix}-`, ...nested]
    })
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length === 0) return [`${prefix}{}`]

    return entries.flatMap(([key, entryValue]: [string, YamlValue]) => {
      if (entryValue === undefined) return []
      if (typeof entryValue === 'string' && entryValue.includes('\n')) {
        return [
          `${prefix}${key}: |`,
          ...entryValue.split('\n').map((line) => `${prefix}  ${line}`),
        ]
      }
      if (Array.isArray(entryValue)) {
        if (entryValue.length === 0) return [`${prefix}${key}: []`]
        return [`${prefix}${key}:`, ...serializeYamlValue(entryValue, indent + 2)]
      }
      if (entryValue && typeof entryValue === 'object') {
        const nested = serializeYamlValue(entryValue, indent + 2)
        return [`${prefix}${key}:`, ...nested]
      }
      return [`${prefix}${key}: ${serializeScalar(entryValue)}`]
    })
  }

  return [`${prefix}${serializeScalar(value)}`]
}

export function toSimpleYaml(
  obj: Record<string, YamlValue | undefined>
): string {
  const filtered = Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined)
  ) as Record<string, YamlValue>

  if (Object.keys(filtered).length === 0) return '\n'

  return `${serializeYamlValue(filtered).join('\n')}\n`
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
