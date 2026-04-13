/**
 * Model Factory
 *
 * All inference requests are routed through the Ax-Studio local proxy server
 * (default: http://127.0.0.1:1337/v1).  The proxy holds provider API keys in
 * the Rust backend, injects auth headers, and forwards to the correct upstream
 * API (OpenAI, Anthropic, Gemini, Groq, Ollama, LM Studio, your FastAPI, etc.).
 *
 * This means the frontend NEVER touches raw API keys — they live only in the
 * Tauri AppState (provider_configs).  Adding a new provider or local endpoint
 * requires no TypeScript changes; just register it in provider_configs via the
 * Settings → Providers UI.
 *
 * Usage:
 * ```typescript
 * const model = await ModelFactory.createModel(modelId, provider, parameters)
 * ```
 */

/**
 * Inference parameters for customizing model behavior
 */
export interface ModelParameters {
  temperature?: number
  top_k?: number
  top_p?: number
  repeat_penalty?: number
  max_output_tokens?: number
  presence_penalty?: number
  frequency_penalty?: number
  stop_sequences?: string[]
}

import { type LanguageModel } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { useLocalApiServer } from '@/hooks/settings/useLocalApiServer'

// Use the webview's native fetch for AI requests to the local proxy.
// Tauri's HTTP plugin (tauriFetch) bypasses CORS but its Response.body
// ReadableStream doesn't support pipeThrough() — which the AI SDK v5
// requires for SSE parsing (TextDecoderStream → EventSourceParserStream).
// The Rust proxy accepts CORS preflight from tauri:// origins on loopback,
// so native fetch works without CORS issues.
const httpFetch = globalThis.fetch

/**
 * Returns the base URL of the local proxy server.
 * Reads live from the Zustand store so it always reflects the current settings.
 */
function getProxyBaseUrl(): string {
  const { serverHost, serverPort, apiPrefix } = useLocalApiServer.getState()
  return `http://${serverHost}:${serverPort}${apiPrefix}`
}

/**
 * Maps ModelParameters (internal names) to OpenAI-compatible request body fields.
 * Unsupported fields (top_k, repeat_penalty) are dropped; non-standard names are mapped.
 * Undefined/null values are omitted so the request body stays clean.
 */
function toOpenAIParams(parameters: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const p = parameters as Partial<ModelParameters>

  if (p.temperature != null) result.temperature = p.temperature
  if (p.top_p != null) result.top_p = p.top_p
  if (p.presence_penalty != null) result.presence_penalty = p.presence_penalty
  if (p.frequency_penalty != null) result.frequency_penalty = p.frequency_penalty
  // OpenAI uses `max_tokens`, not `max_output_tokens`
  if (p.max_output_tokens != null) result.max_tokens = p.max_output_tokens
  // OpenAI uses `stop`, not `stop_sequences`
  if (p.stop_sequences != null) result.stop = p.stop_sequences
  // top_k and repeat_penalty are not valid OpenAI API fields — intentionally omitted

  return result
}

function toOpenAICompatibleString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    const text = value
      .map((item) => toOpenAICompatibleString(item))
      .filter((item): item is string => item != null && item.length > 0)
      .join('')

    if (text.length > 0) return text

    try {
      return JSON.stringify(value)
    } catch {
      return null
    }
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>

    if (typeof record.text === 'string') return record.text
    if (typeof record.value === 'string') return record.value

    if (Array.isArray(record.content)) {
      return toOpenAICompatibleString(record.content)
    }

    try {
      return JSON.stringify(value)
    } catch {
      return null
    }
  }

  return null
}

function normalizeOpenAICompatibleToolCall(
  toolCall: unknown,
  index: number,
  requireIndex: boolean
): { toolCall: unknown; changed: boolean } {
  if (!toolCall || typeof toolCall !== 'object' || Array.isArray(toolCall)) {
    return { toolCall, changed: false }
  }

  const normalized = { ...(toolCall as Record<string, unknown>) }
  let changed = false

  if (requireIndex && typeof normalized.index !== 'number') {
    normalized.index = index
    changed = true
  }

  if (normalized.id != null && typeof normalized.id !== 'string') {
    normalized.id = String(normalized.id)
    changed = true
  }

  if (
    normalized.function &&
    typeof normalized.function === 'object' &&
    !Array.isArray(normalized.function)
  ) {
    const fn = { ...(normalized.function as Record<string, unknown>) }

    if (fn.name != null && typeof fn.name !== 'string') {
      fn.name = String(fn.name)
      changed = true
    }

    if (fn.arguments != null && typeof fn.arguments !== 'string') {
      const normalizedArguments = toOpenAICompatibleString(fn.arguments)
      if (normalizedArguments != null) {
        fn.arguments = normalizedArguments
        changed = true
      }
    }

    normalized.function = fn
  }

  return { toolCall: normalized, changed }
}

function normalizeOpenAICompatiblePayload(
  payload: Record<string, unknown>,
  requireToolCallIndex: boolean
): boolean {
  let changed = false

  for (const field of ['content', 'reasoning_content', 'reasoning'] as const) {
    const value = payload[field]
    if (value != null && typeof value !== 'string') {
      const normalizedValue = toOpenAICompatibleString(value)
      if (normalizedValue != null) {
        payload[field] = normalizedValue
        changed = true
      }
    }
  }

  if ('role' in payload && payload.role != null && typeof payload.role !== 'string') {
    payload.role = String(payload.role)
    changed = true
  }

  if (Array.isArray(payload.tool_calls)) {
    payload.tool_calls = payload.tool_calls.map((toolCall, index) => {
      const normalizedToolCall = normalizeOpenAICompatibleToolCall(
        toolCall,
        index,
        requireToolCallIndex
      )
      changed ||= normalizedToolCall.changed
      return normalizedToolCall.toolCall
    })
  }

  return changed
}

export function normalizeOpenAICompatibleEventData(data: string): string {
  try {
    const parsed = JSON.parse(data) as Record<string, unknown>
    if (!Array.isArray(parsed.choices)) return data

    let changed = false

    for (const choice of parsed.choices) {
      if (!choice || typeof choice !== 'object' || Array.isArray(choice)) continue

      const normalizedChoice = choice as Record<string, unknown>

      if (
        normalizedChoice.finish_reason != null &&
        typeof normalizedChoice.finish_reason !== 'string'
      ) {
        normalizedChoice.finish_reason = String(normalizedChoice.finish_reason)
        changed = true
      }

      if (
        normalizedChoice.delta &&
        typeof normalizedChoice.delta === 'object' &&
        !Array.isArray(normalizedChoice.delta)
      ) {
        changed =
          normalizeOpenAICompatiblePayload(
            normalizedChoice.delta as Record<string, unknown>,
            true
          ) || changed
      }

      if (
        normalizedChoice.message &&
        typeof normalizedChoice.message === 'object' &&
        !Array.isArray(normalizedChoice.message)
      ) {
        changed =
          normalizeOpenAICompatiblePayload(
            normalizedChoice.message as Record<string, unknown>,
            false
          ) || changed
      }
    }

    return changed ? JSON.stringify(parsed) : data
  } catch {
    return data
  }
}

function normalizeOpenAICompatibleSseLine(line: string): string {
  const prefix = line.startsWith('data: ')
    ? 'data: '
    : line.startsWith('data:')
      ? 'data:'
      : null

  if (!prefix) return line

  const data = line.slice(prefix.length).trimStart()
  if (data === '[DONE]') return line

  const normalized = normalizeOpenAICompatibleEventData(data)
  return normalized === data ? line : `${prefix}${normalized}`
}

/**
 * Creates a fetch wrapper that normalizes non-standard streaming SSE responses.
 *
 * The Vercel AI SDK validates streaming chunks strictly against the OpenAI spec.
 * Several providers return slightly non-conformant responses that cause
 * "Type validation failed" errors. This wrapper patches known issues:
 *
 * 1. **Missing tool_call index** (Gemini): Gemini's OpenAI-compatible SSE omits the
 *    required `index` field on `choices[].delta.tool_calls[]` items.
 *
 * 2. **Non-string content/reasoning/tool args** (Cloudflare Workers AI and others):
 *    Some models return text-ish fields as numbers, arrays, or objects rather than
 *    plain strings. This includes `content`, `reasoning_content`, `reasoning`, and
 *    `tool_calls[].function.arguments`.
 *
 * 3. **Numeric role** (various): Some providers return `role` as a non-string value.
 *
 * Applied to ALL providers since the proxy passes streaming bytes through unchanged.
 */
function createStreamingPatchFetch(baseFetch: typeof httpFetch): typeof httpFetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await baseFetch(input, init)
    const contentType = response.headers.get('content-type') ?? ''

    // Tauri HTTP plugin's Response.text() can hang on error responses with
    // empty or non-JSON content-type. Intercept non-200 responses here and
    // re-create a plain Response whose body the AI SDK can safely read.
    if (!response.ok) {
      let errorBody = ''
      try {
        // Read with a 5-second timeout to prevent hanging
        errorBody = await Promise.race([
          response.text(),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout reading error body')), 5000)
          ),
        ])
      } catch {
        errorBody = `HTTP ${response.status} ${response.statusText || 'Error'}`
      }
      console.error(`[StreamingPatch] proxy error ${response.status}: ${errorBody.slice(0, 300)}`)
      // Return a new Response with a plain-text body the SDK can parse
      return new Response(errorBody, {
        status: response.status,
        statusText: response.statusText,
        headers: new Headers({ 'content-type': 'text/plain' }),
      })
    }

    if (!contentType.includes('text/event-stream') || !response.body) {
      return response
    }

    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    let buffer = ''

    const transform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        const patched = lines.map((line) => normalizeOpenAICompatibleSseLine(line))

        controller.enqueue(encoder.encode(patched.join('\n') + '\n'))
      },
      flush(controller) {
        if (buffer.trim()) {
          controller.enqueue(encoder.encode(normalizeOpenAICompatibleSseLine(buffer)))
        }
      },
    })

    try {
      const patchedBody = response.body.pipeThrough(transform)
      return new Response(patchedBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    } catch (e) {
      console.warn('[StreamingPatch] pipeThrough failed, returning original:', e)
      return response
    }
  }
}

/**
 * Creates a fetch wrapper that merges OpenAI-compatible inference parameters
 * into the POST request body (temperature, top_p, max_tokens, etc.).
 */
function createCustomFetch(
  baseFetch: typeof httpFetch,
  parameters: Record<string, unknown>
): typeof httpFetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if ((init?.method === 'POST' || !init?.method) && Object.keys(parameters).length > 0) {
      if (typeof init?.body !== 'string') {
        // Body is Blob, ReadableStream, FormData, etc. — skip parameter injection
        return baseFetch(input, init)
      }
      let body: Record<string, unknown> = {}
      try {
        body = JSON.parse(init.body)
      } catch {
        // body is not JSON, skip parameter injection
        return baseFetch(input, init)
      }
      init = { ...init, body: JSON.stringify({ ...body, ...parameters }) }
    }
    return baseFetch(input, init)
  }
}

/**
 * Factory for creating language models.
 *
 * All providers (cloud and local) are routed through the Ax-Studio local proxy
 * (port 1337 by default).  The proxy handles:
 *   - API key injection from secure Rust backend storage
 *   - Provider-specific header requirements (e.g. anthropic-version)
 *   - Routing based on model_id → registered provider_configs
 *   - Forwarding to the correct upstream URL (cloud or localhost)
 *
 * Supported via provider_configs registration:
 *   Cloud  : OpenAI, Anthropic, Gemini, Groq, Mistral, Azure, OpenRouter, HuggingFace, …
 *   Local  : Ollama (localhost:11434), LM Studio (localhost:1234), your FastAPI (port 8000)
 */
export class ModelFactory {
  /**
   * Create a language model that routes through the local proxy server.
   */
  static async createModel(
    modelId: string,
    provider: ProviderObject,
    parameters: Record<string, unknown> = {}
  ): Promise<LanguageModel> {
    const proxyUrl = getProxyBaseUrl()
    const openAIParams = toOpenAIParams(parameters)
    const providerName = provider.provider.toLowerCase()

    // Normalize non-standard streaming SSE responses from various providers.
    // Applied to all providers since the proxy passes streaming bytes through unchanged.
    const baseFetch = createStreamingPatchFetch(httpFetch)
    const fetchFn =
      Object.keys(openAIParams).length > 0
        ? createCustomFetch(baseFetch, openAIParams)
        : baseFetch

    // All providers go through the proxy using the OpenAI-compatible format.
    // The proxy routes the request to the correct upstream based on model_id lookup
    // in provider_configs, injects the real API key, and applies custom headers.
    const proxyModel = createOpenAICompatible({
      name: providerName,
      baseURL: proxyUrl,
      // No Authorization header here — proxy injects the real key from provider_configs.
      // Passing a headers object prevents the SDK from looking up env vars.
      // X-Ax-Provider tells the proxy which registered provider to route to,
      // avoiding ambiguity when the same model ID exists in multiple providers.
      headers: { 'X-Ax-Provider': provider.provider },
      includeUsage: true,
      fetch: fetchFn,
    })

    return proxyModel.languageModel(modelId)
  }
}
