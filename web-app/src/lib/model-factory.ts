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
import { useLocalApiServer } from '@/hooks/settings/useLocalApiServer'

// SSE streaming to the LOCAL proxy (127.0.0.1:1337) must use the webview's
// native fetch — Tauri's HTTP plugin buffers the entire SSE body before
// returning a Response, so `response.body` is effectively a completed stream
// by the time the AI SDK reads it and no tokens ever render incrementally.
// The proxy enables CORS headers, so the native preflight succeeds.
// Remote HTTPS targets keep using Tauri's plugin to bypass the webview's
// same-origin restrictions.
const httpFetch: typeof globalThis.fetch = (input, init) => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : (input as Request).url
  const isLocalProxy =
    url.startsWith('http://127.0.0.1') ||
    url.startsWith('http://localhost') ||
    url.startsWith('http://0.0.0.0')
  if (isPlatformTauri() && !isLocalProxy) {
    return tauriFetch(input, init) as unknown as Promise<Response>
  }
  return globalThis.fetch(input, init)
}

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
 * Creates a fetch wrapper that normalizes non-standard streaming SSE responses.
 *
 * The Vercel AI SDK validates streaming chunks strictly against the OpenAI spec.
 * Several providers return slightly non-conformant responses that cause
 * "Type validation failed" errors. This wrapper patches known issues:
 *
 * 1. **Missing tool_call index** (Gemini): Gemini's OpenAI-compatible SSE omits the
 *    required `index` field on `choices[].delta.tool_calls[]` items.
 *
 * 2. **Numeric content** (Cloudflare Workers AI): Some models return
 *    `choices[].delta.content` as a number (e.g. `0`) instead of a string (`"0"`).
 *    This happens when the model outputs a digit token.
 *
 * 3. **Numeric role** (various): Some providers return `role` as a non-string value.
 *
 * Applied to ALL providers since the proxy passes streaming bytes through unchanged.
 */
function createStreamingPatchFetch(baseFetch: typeof httpFetch): typeof httpFetch {
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
            if (!Array.isArray(parsed.choices)) return line

            let patched = false
            for (const choice of parsed.choices) {
              const delta = choice.delta
              if (!delta) continue

              // Fix 1: Coerce non-string `content` to string (Cloudflare Workers AI)
              if ('content' in delta && delta.content != null && typeof delta.content !== 'string') {
                delta.content = String(delta.content)
                patched = true
              }

              // Fix 2: Inject missing `index` on tool_calls (Gemini)
              if (Array.isArray(delta.tool_calls)) {
                delta.tool_calls = delta.tool_calls.map(
                  (tc: Record<string, unknown>, i: number) => {
                    if (typeof tc.index !== 'number') {
                      patched = true
                      return { index: i, ...tc }
                    }
                    return tc
                  }
                )
              }

              // Fix 3: Coerce non-string `role` to string
              if ('role' in delta && delta.role != null && typeof delta.role !== 'string') {
                delta.role = String(delta.role)
                patched = true
              }

              // Fix 4: Promote `reasoning_content` to `content` for reasoning
              // models exposed via OpenAI-compatible endpoints (DeepSeek-R1,
              // Cloudflare's @cf/zai-org/glm-4.7-flash, etc.). These models
              // emit their output in a non-standard `reasoning_content` field
              // that the Vercel AI SDK's OpenAI-compat parser ignores, so the
              // UI shows nothing but the "thinking" indicator forever.
              // Merge into `content` so the chat actually renders.
              if (
                'reasoning_content' in delta &&
                typeof delta.reasoning_content === 'string' &&
                delta.reasoning_content.length > 0
              ) {
                const existing =
                  typeof delta.content === 'string' ? delta.content : ''
                delta.content = existing + delta.reasoning_content
                delete delta.reasoning_content
                patched = true
              }
            }

            // Only re-serialize if we actually changed something (avoid unnecessary work)
            return patched ? `data: ${JSON.stringify(parsed)}` : line
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
    //
    // Auth: the local proxy runs with its own `proxy_api_key` for access control
    // (not the upstream provider key). The client must prove it's allowed to use
    // this proxy; the proxy then swaps in the real provider key before forwarding.
    // Previously no Authorization header was sent, so the proxy replied 401 and
    // the UI hung on "thinking" forever waiting for a stream that never started.
    const localProxyKey = useLocalApiServer.getState().apiKey
    const proxyHeaders: Record<string, string> = {
      'X-Ax-Provider': provider.provider,
    }
    if (localProxyKey && localProxyKey.trim().length > 0) {
      proxyHeaders.Authorization = `Bearer ${localProxyKey}`
    }

    const proxyModel = createOpenAICompatible({
      name: providerName,
      baseURL: proxyUrl,
      // Passing a headers object prevents the SDK from looking up env vars.
      // X-Ax-Provider tells the proxy which registered provider to route to,
      // avoiding ambiguity when the same model ID exists in multiple providers.
      headers: proxyHeaders,
      includeUsage: true,
      fetch: fetchFn,
    })

    return proxyModel.languageModel(modelId)
  }
}
