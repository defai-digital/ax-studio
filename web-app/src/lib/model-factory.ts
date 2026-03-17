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
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { isPlatformTauri } from '@/lib/platform'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'

// Use Tauri's HTTP plugin on native; fall back to native fetch for web/browser.
const httpFetch = isPlatformTauri() ? tauriFetch : globalThis.fetch

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

/**
 * Creates a fetch wrapper that patches Gemini's non-standard streaming tool_calls format.
 *
 * Gemini's OpenAI-compatible SSE chunks omit the required `index` field on tool_calls
 * items.  The Vercel AI SDK validates this strictly.  This wrapper injects `index: i`
 * where it is missing so downstream parsing succeeds.
 *
 * The proxy passes streaming bytes through unchanged, so we still need this patch
 * on the client side even when routing through the proxy.
 */
function createGeminiPatchedFetch(baseFetch: typeof httpFetch): typeof httpFetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await baseFetch(input, init)
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/event-stream') || !response.body) {
      return response
    }

    const reader = response.body.getReader()
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    let buffer = ''

    const transformedBody = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read()
        if (done) {
          if (buffer.trim()) controller.enqueue(encoder.encode(buffer))
          controller.close()
          return
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        const patched = lines.map((line) => {
          if (!line.startsWith('data: ')) return line
          const json = line.slice(6)
          if (json === '[DONE]') return line
          try {
            const parsed = JSON.parse(json)
            if (Array.isArray(parsed.choices)) {
              for (const choice of parsed.choices) {
                if (Array.isArray(choice.delta?.tool_calls)) {
                  choice.delta.tool_calls = choice.delta.tool_calls.map(
                    (tc: Record<string, unknown>, i: number) =>
                      typeof tc.index === 'number' ? tc : { index: i, ...tc }
                  )
                }
              }
            }
            return `data: ${JSON.stringify(parsed)}`
          } catch {
            return line
          }
        })

        controller.enqueue(encoder.encode(patched.join('\n') + '\n'))
      },
      cancel() {
        reader.cancel()
      },
    })

    return new Response(transformedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
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

    // Gemini's streaming SSE omits `index` on tool_calls — patch it on the way back.
    // This is applied at the client level since the proxy passes streaming bytes through.
    const isGemini = ['google', 'gemini'].includes(providerName)
    const baseFetch = isGemini ? createGeminiPatchedFetch(httpFetch) : httpFetch
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
      // Passing an empty headers object prevents the SDK from looking up env vars.
      headers: {},
      includeUsage: true,
      fetch: fetchFn,
    })

    return proxyModel.languageModel(modelId)
  }
}
