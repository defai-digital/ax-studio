/**
 * Fetch shim that routes the `mlx` provider's chat completion requests through
 * Tauri IPC (`mlx_chat_stream` / `mlx_chat_completion`) instead of HTTP.
 *
 * Why this exists
 * ---------------
 * The chat transport pipeline (Vercel AI SDK + `createOpenAICompatible`) drives
 * an HTTP `fetch` per chat request. For every provider we point that fetch at
 * the local Rust proxy on `http://127.0.0.1:1337`, which then forwards to the
 * upstream model server.
 *
 * For the `mlx` provider, the "upstream" lives inside this very process —
 * `ax-engine-sdk` is linked into `src-tauri` and runs MLX natively on Metal.
 * Routing chat through HTTP → proxy → ax-engine-server → mlx_lm would mean two
 * extra hops and a subprocess we don't need. Instead we substitute the `fetch`
 * given to `createOpenAICompatible` with this shim. The shim:
 *
 *  1. Parses the OpenAI chat-completion request from the request body.
 *  2. Ensures the model is loaded via `invoke('mlx_load_model', ...)` (idempotent).
 *  3. For streaming requests: opens a `tauri::ipc::Channel<StreamEvent>`,
 *     invokes `mlx_chat_stream`, and re-emits the events as OpenAI-compatible
 *     SSE chunks on a `ReadableStream` so the upstream SDK is none the wiser.
 *  4. For non-streaming requests: invokes `mlx_chat_completion` and returns a
 *     plain JSON `Response`.
 *
 * Known limitation
 * ----------------
 * Until https://github.com/defai-digital/ax-engine/issues/23 is fixed, calls
 * that trigger the 4-bit MLX slice bug will abort the entire `ax-studio`
 * process (it's an MLX C++ `abort()`, not a Rust error — uncatchable). The
 * chat UI will appear to hang briefly and then the app closes. This is a
 * **deliberate trade-off**: routing through IPC lets us validate the
 * architecture today, so once upstream patches the slice op no frontend
 * changes are needed.
 *
 * Falling back to HTTP when in-process fails is not possible: by the time the
 * crash happens, the process is gone.
 */

import { Channel, invoke } from '@tauri-apps/api/core'
import { useAppState } from '@/hooks/settings/useAppState'

interface OpenAIChatMessage {
  role: string
  content: string
}

interface OpenAIChatRequest {
  model: string
  messages: OpenAIChatMessage[]
  stream?: boolean
  max_tokens?: number
  max_completion_tokens?: number
  temperature?: number
  top_p?: number
  top_k?: number
  frequency_penalty?: number
  seed?: number
  stop?: string | string[]
}

interface MlxGenerateParams {
  max_output_tokens?: number
  temperature?: number
  top_p?: number
  top_k?: number
  repetition_penalty?: number
  seed?: number
  stop?: string[]
}

interface MlxChatCompletion {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: Array<{
    index: number
    message: { role: string; content: string }
    finish_reason: string
  }>
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

type StreamEvent =
  | { type: 'start'; model_id: string; prompt_token_count: number }
  | { type: 'delta'; text: string }
  | {
      type: 'done'
      prompt_token_count: number
      output_token_count: number
      finish_reason: string
      /**
       * Wall-clock time (ms) the Rust worker spent inside `session.generate()`.
       * The chat transport's own t/s math is computed from first/last Delta
       * timestamps, which collapse to ~0 ms in our stream-as-blocking
       * workaround (the whole response arrives as a single chunk). We use
       * this Rust-measured duration to override the transport's bogus value.
       */
      elapsed_ms: number
    }
  | { type: 'error'; message: string }

const SSE_HEADERS = { 'Content-Type': 'text/event-stream; charset=utf-8' }
const JSON_HEADERS = { 'Content-Type': 'application/json' }

function toMlxParams(req: OpenAIChatRequest): MlxGenerateParams {
  const stop = typeof req.stop === 'string' ? [req.stop] : req.stop
  return {
    max_output_tokens: req.max_completion_tokens ?? req.max_tokens,
    temperature: req.temperature,
    top_p: req.top_p,
    top_k: req.top_k,
    repetition_penalty: req.frequency_penalty != null
      ? 1 + req.frequency_penalty
      : undefined,
    seed: req.seed,
    stop,
  }
}

/**
 * Wrap an MLX chat-completion result in an OpenAI-compatible JSON Response.
 */
function nonStreamResponse(result: MlxChatCompletion): Response {
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: JSON_HEADERS,
  })
}

/**
 * Build a streaming Response whose body is an OpenAI-format SSE stream backed
 * by `mlx_chat_stream`'s `StreamEvent` channel.
 */
function streamingResponse(
  modelId: string,
  messages: OpenAIChatMessage[],
  params: MlxGenerateParams,
): Response {
  const encoder = new TextEncoder()
  const created = Math.floor(Date.now() / 1000)
  const id = `mlx-${created}-${Math.random().toString(36).slice(2, 10)}`

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const channel = new Channel<StreamEvent>()

      const writeChunk = (delta: { role?: string; content?: string }, finish_reason: string | null) => {
        const chunk = {
          id,
          object: 'chat.completion.chunk',
          created,
          model: modelId,
          choices: [{ index: 0, delta, finish_reason }],
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
      }

      let firstDeltaSent = false
      let lastErr: string | null = null

      channel.onmessage = (evt) => {
        try {
          if (evt.type === 'start') {
            // Send a role-only opening chunk to match OpenAI's SSE shape.
            writeChunk({ role: 'assistant' }, null)
            firstDeltaSent = true
          } else if (evt.type === 'delta') {
            if (!firstDeltaSent) {
              writeChunk({ role: 'assistant' }, null)
              firstDeltaSent = true
            }
            writeChunk({ content: evt.text }, null)
          } else if (evt.type === 'done') {
            // Final chunk with finish_reason + usage on the same event.
            const final = {
              id,
              object: 'chat.completion.chunk',
              created,
              model: modelId,
              choices: [{ index: 0, delta: {}, finish_reason: evt.finish_reason }],
              usage: {
                prompt_tokens: evt.prompt_token_count,
                completion_tokens: evt.output_token_count,
                total_tokens: evt.prompt_token_count + evt.output_token_count,
              },
            }
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(final)}\n\n`))
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()

            // Replace the chat transport's bogus first-to-last-delta
            // calculation (microseconds → tens-of-thousands t/s) with the
            // real number measured by the Rust worker. Delayed one tick so
            // the transport's own setTokenSpeed call from its stream-close
            // handler runs first and ours wins the final write.
            if (evt.elapsed_ms > 0 && evt.output_token_count > 0) {
              const realTps = Math.round(
                (evt.output_token_count / (evt.elapsed_ms / 1000)) * 10
              ) / 10
              setTimeout(() => {
                useAppState
                  .getState()
                  .setTokenSpeed(
                    { id: 'streaming' } as never,
                    realTps,
                    evt.output_token_count
                  )
              }, 50)
            }
          } else if (evt.type === 'error') {
            lastErr = evt.message
            // Don't close yet — the `done` event should still arrive from the
            // worker. If it doesn't, the invoke() rejection below handles it.
          }
        } catch (e) {
          controller.error(e)
        }
      }

      try {
        // Idempotent — Rust resolves the HF cache snapshot from modelId.
        await invoke('mlx_load_model', { modelId })
        await invoke('mlx_chat_stream', { modelId, messages, params, onEvent: channel })
      } catch (e) {
        if (lastErr == null) lastErr = e instanceof Error ? e.message : String(e)
        controller.error(new Error(`[mlx-ipc-fetch] ${lastErr}`))
      }
    },
  })

  return new Response(stream, { status: 200, headers: SSE_HEADERS })
}

/**
 * Returns a fetch-compatible function that dispatches every `/v1/chat/completions`
 * request through Tauri IPC. The caller passes this as `fetch` to
 * `createOpenAICompatible`; the SDK never realizes it's not talking to HTTP.
 */
export function createMlxIpcFetch(): typeof fetch {
  return async function mlxIpcFetch(
    _input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method !== 'POST') {
      return new Response(JSON.stringify({ error: 'mlx fetch supports POST only' }), {
        status: 405,
        headers: JSON_HEADERS,
      })
    }

    let parsed: OpenAIChatRequest
    try {
      const raw = typeof init?.body === 'string' ? init.body : await new Response(init?.body).text()
      parsed = JSON.parse(raw) as OpenAIChatRequest
    } catch (e) {
      return new Response(
        JSON.stringify({ error: 'mlx fetch could not parse request body', detail: String(e) }),
        { status: 400, headers: JSON_HEADERS },
      )
    }

    const modelId = parsed.model
    const messages = parsed.messages ?? []
    const params = toMlxParams(parsed)

    if (parsed.stream) {
      return streamingResponse(modelId, messages, params)
    }

    try {
      await invoke('mlx_load_model', { modelId })
      const result = await invoke<MlxChatCompletion>('mlx_chat_completion', {
        modelId,
        messages,
        params,
      })
      return nonStreamResponse(result)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return new Response(
        JSON.stringify({ error: `[mlx-ipc-fetch] ${message}` }),
        { status: 500, headers: JSON_HEADERS },
      )
    }
  } as typeof fetch
}
