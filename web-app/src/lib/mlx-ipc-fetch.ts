/**
 * Fetch shim that routes the `mlx` provider's chat completion requests through
 * Tauri IPC (`mlx_chat_stream` / `mlx_chat_completion`) instead of HTTP.
 *
 * Why this exists
 * ---------------
 * The chat transport pipeline (Vercel AI SDK + `createOpenAICompatible`) drives
 * an HTTP `fetch` per chat request. For every provider we point that fetch at
 * the local Rust proxy on `http://127.0.0.1:31419`, which then forwards to the
 * upstream model server.
 *
 * For the `mlx` provider, the "upstream" lives inside this very process —
 * `ax-engine-sdk` is linked into `src-tauri` and runs MLX natively on Metal.
 * This is the **in_process** Local Engine backend (ADR-009 / ax-engine
 * LOCAL-ENGINE-CLIENTS). Routing chat through HTTP → proxy → ax-engine-server
 * would mean two extra hops and a subprocess we don't need. Instead we
 * substitute the `fetch` given to `createOpenAICompatible` with this shim
 * (also exposed via `InProcessLocalEngineBackend.createChatFetch`). The shim:
 *
 *  1. Parses the OpenAI chat-completion request from the request body.
 *  2. Ensures the model is loaded via `invoke('mlx_load_model', ...)` (idempotent).
 *  3. For streaming requests: opens a `tauri::ipc::Channel<StreamEvent>`,
 *     invokes `mlx_chat_stream`, and re-emits the events as OpenAI-compatible
 *     SSE chunks on a `ReadableStream` so the upstream SDK is none the wiser.
 *  4. For non-streaming requests: invokes `mlx_chat_completion` and returns a
 *     plain JSON `Response`.
 *
 */

import { Channel, invoke } from '@tauri-apps/api/core'
import type { MetadataExtractor } from '@ai-sdk/openai-compatible'

interface OpenAIChatMessage {
  role: string
  /** OpenAI allows string | null | content-part arrays (vision / tool turns). */
  content?: string | null | Array<Record<string, unknown> | string>
  tool_calls?: unknown
  name?: string
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

/** Wire shape sent to Rust `ChatMessage` (plain string content only). */
interface MlxWireChatMessage {
  role: string
  content: string
}

/**
 * Coerce AI SDK / OpenAI message shapes into the plain string content the
 * MLX worker expects. Without this:
 *  - tool-call assistant turns (`content: null`) fail serde permanently
 *  - image attachment arrays fail serde permanently
 */
function sanitizeMessagesForMlx(
  messages: OpenAIChatMessage[]
): { messages: MlxWireChatMessage[]; rejectedReason?: string } {
  const out: MlxWireChatMessage[] = []
  for (const msg of messages) {
    const role = typeof msg.role === 'string' ? msg.role : 'user'
    const raw = msg.content

    if (raw == null) {
      // Tool-call turns often have content: null + tool_calls. Drop tool_calls
      // (ax-engine has no tools wire yet) and send empty text.
      out.push({ role, content: '' })
      continue
    }

    if (typeof raw === 'string') {
      out.push({ role, content: raw })
      continue
    }

    if (Array.isArray(raw)) {
      const texts: string[] = []
      let sawImage = false
      for (const part of raw) {
        if (typeof part === 'string') {
          texts.push(part)
          continue
        }
        if (part && typeof part === 'object') {
          const type = String((part as { type?: unknown }).type ?? 'text')
          if (type === 'text' && typeof (part as { text?: unknown }).text === 'string') {
            texts.push((part as { text: string }).text)
          } else if (
            type === 'image_url' ||
            type === 'image' ||
            type === 'file' ||
            type === 'input_image'
          ) {
            sawImage = true
          }
        }
      }
      if (sawImage && texts.length === 0) {
        return {
          messages: [],
          rejectedReason:
            'AX Engine does not support image attachments yet. Remove images or use a different provider.',
        }
      }
      if (sawImage) {
        console.warn(
          '[mlx-ipc-fetch] dropping image content parts (ax-engine multimodal not wired)'
        )
      }
      out.push({ role, content: texts.join('\n') })
      continue
    }

    out.push({ role, content: String(raw) })
  }
  return { messages: out }
}

/** Module-level mutex: at most one active MLX generation at a time. */
let mlxRequestChain: Promise<unknown> = Promise.resolve()

function withMlxRequestLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = mlxRequestChain.then(fn, fn)
  // Keep the chain alive regardless of success/failure; swallow so a
  // rejected request doesn't poison subsequent ones.
  mlxRequestChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
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
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
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
       * Wall-clock time (ms) the Rust worker spent inside native streaming.
       * Kept for diagnostics and possible speed display fallbacks.
       */
      elapsed_ms: number
      performance?: AxEnginePerformanceWireMetrics
    }
  | { type: 'error'; message: string }

const SSE_HEADERS = { 'Content-Type': 'text/event-stream; charset=utf-8' }
const JSON_HEADERS = { 'Content-Type': 'application/json' }

interface AxEngineWireMetrics {
  elapsed_ms: number
  output_token_count: number
  generation_kind: 'autoregressive' | 'block_diffusion'
  performance?: AxEnginePerformanceWireMetrics
}

interface AxEngineMtpWireMetrics {
  available: boolean
  requested: boolean
  active: boolean
  direct_fallback_steps: number
  draft_tokens: number
  accepted_tokens: number
  decode_steps: number
}

interface AxEnginePerformanceWireMetrics {
  metrics_version: number
  total_time_us: number
  time_to_first_token_us?: number | null
  generation_time_us?: number | null
  generation_token_count: number
  prompt_eval_time_us?: number | null
  prompt_runner_time_us?: number | null
  model_eval_time_us?: number | null
  model_runner_time_us?: number | null
  model_eval_token_count?: number | null
  generation_kind: 'autoregressive' | 'block_diffusion'
  mtp: AxEngineMtpWireMetrics
}

const AX_ENGINE_METRICS_VERSIONS = new Set([1, 2])

const isNonNegativeFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

function readAxEnginePerformanceWireMetrics(
  value: unknown
): AxEnginePerformanceWireMetrics | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const record = value as Record<string, unknown>
  const mtpValue = record.mtp
  if (!mtpValue || typeof mtpValue !== 'object' || Array.isArray(mtpValue)) {
    return
  }
  const mtp = mtpValue as Record<string, unknown>

  const optionalDurationIsValid = (duration: unknown) =>
    duration == null || isNonNegativeFiniteNumber(duration)
  if (
    !isNonNegativeFiniteNumber(record.metrics_version) ||
    !AX_ENGINE_METRICS_VERSIONS.has(record.metrics_version) ||
    !isNonNegativeFiniteNumber(record.total_time_us) ||
    !optionalDurationIsValid(record.time_to_first_token_us) ||
    !optionalDurationIsValid(record.generation_time_us) ||
    !optionalDurationIsValid(record.prompt_eval_time_us) ||
    !optionalDurationIsValid(record.prompt_runner_time_us) ||
    !optionalDurationIsValid(record.model_eval_time_us) ||
    !optionalDurationIsValid(record.model_runner_time_us) ||
    !optionalDurationIsValid(record.model_eval_token_count) ||
    !isNonNegativeFiniteNumber(record.generation_token_count) ||
    (record.generation_kind !== 'autoregressive' &&
      record.generation_kind !== 'block_diffusion') ||
    typeof mtp.available !== 'boolean' ||
    typeof mtp.requested !== 'boolean' ||
    typeof mtp.active !== 'boolean' ||
    !isNonNegativeFiniteNumber(mtp.direct_fallback_steps) ||
    !isNonNegativeFiniteNumber(mtp.draft_tokens) ||
    !isNonNegativeFiniteNumber(mtp.accepted_tokens) ||
    !isNonNegativeFiniteNumber(mtp.decode_steps)
  ) {
    return
  }

  return {
    metrics_version: record.metrics_version,
    total_time_us: record.total_time_us,
    time_to_first_token_us: record.time_to_first_token_us as
      | number
      | null
      | undefined,
    generation_time_us: record.generation_time_us as
      | number
      | null
      | undefined,
    generation_token_count: record.generation_token_count,
    prompt_eval_time_us: record.prompt_eval_time_us as
      | number
      | null
      | undefined,
    prompt_runner_time_us: record.prompt_runner_time_us as
      | number
      | null
      | undefined,
    model_eval_time_us: record.model_eval_time_us as
      | number
      | null
      | undefined,
    model_runner_time_us: record.model_runner_time_us as
      | number
      | null
      | undefined,
    model_eval_token_count: record.model_eval_token_count as
      | number
      | null
      | undefined,
    generation_kind: record.generation_kind,
    mtp: {
      available: mtp.available,
      requested: mtp.requested,
      active: mtp.active,
      direct_fallback_steps: mtp.direct_fallback_steps,
      draft_tokens: mtp.draft_tokens,
      accepted_tokens: mtp.accepted_tokens,
      decode_steps: mtp.decode_steps,
    },
  }
}

function readAxEngineWireMetrics(value: unknown): AxEngineWireMetrics | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const metrics = (value as Record<string, unknown>).ax_engine_metrics
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) {
    return undefined
  }

  const record = metrics as Record<string, unknown>
  const elapsedMs = record.elapsed_ms
  const outputTokenCount = record.output_token_count
  const generationKind = record.generation_kind
  if (
    typeof elapsedMs !== 'number' ||
    !Number.isFinite(elapsedMs) ||
    elapsedMs < 0 ||
    typeof outputTokenCount !== 'number' ||
    !Number.isFinite(outputTokenCount) ||
    outputTokenCount < 0 ||
    (generationKind !== 'autoregressive' &&
      generationKind !== 'block_diffusion')
  ) {
    return undefined
  }

  return {
    elapsed_ms: elapsedMs,
    output_token_count: outputTokenCount,
    generation_kind: generationKind,
    performance: readAxEnginePerformanceWireMetrics(record.performance),
  }
}

function providerMetadataForMetrics(metrics: AxEngineWireMetrics) {
  const performance = metrics.performance
  const generationDurationMs =
    performance?.generation_time_us != null
      ? performance.generation_time_us / 1000
      : undefined
  const generationTokenCount = performance?.generation_token_count
  const deliveryTokensPerSecond =
    generationDurationMs != null &&
    generationDurationMs > 0 &&
    generationTokenCount != null &&
    generationTokenCount > 0
      ? (generationTokenCount * 1000) / generationDurationMs
      : undefined
  const modelEvalDurationMs =
    performance?.model_eval_time_us != null
      ? performance.model_eval_time_us / 1000
      : undefined
  const modelEvalTokenCount = performance?.model_eval_token_count ?? undefined
  const modelTokensPerSecond =
    modelEvalDurationMs != null &&
    modelEvalDurationMs > 0 &&
    modelEvalTokenCount != null &&
    modelEvalTokenCount > 0
      ? (modelEvalTokenCount * 1000) / modelEvalDurationMs
      : undefined
  const runnerDurationMs =
    performance?.model_runner_time_us != null
      ? performance.model_runner_time_us / 1000
      : undefined
  const runnerTokensPerSecond =
    runnerDurationMs != null &&
    runnerDurationMs > 0 &&
    modelEvalTokenCount != null &&
    modelEvalTokenCount > 0
      ? (modelEvalTokenCount * 1000) / runnerDurationMs
      : undefined
  const hasSeparatedNativeTiming =
    performance?.metrics_version === 2 &&
    modelEvalDurationMs != null &&
    modelEvalTokenCount != null
  const mtp = performance?.mtp
  const accelerationMode = mtp
    ? mtp.active
      ? 'mtp'
      : mtp.available && mtp.requested && mtp.direct_fallback_steps > 0
        ? 'mtp_fallback'
        : 'direct'
    : undefined

  return {
    axEngine: {
      elapsedMs: metrics.elapsed_ms,
      outputTokenCount: metrics.output_token_count,
      tokensPerSecond:
        modelTokensPerSecond ??
        deliveryTokensPerSecond ??
        (metrics.elapsed_ms > 0
          ? (metrics.output_token_count * 1000) / metrics.elapsed_ms
          : 0),
      generationKind: performance?.generation_kind ?? metrics.generation_kind,
      metricsVersion: performance?.metrics_version,
      totalDurationMs:
        performance != null ? performance.total_time_us / 1000 : undefined,
      timeToFirstTokenMs:
        performance?.time_to_first_token_us != null
          ? performance.time_to_first_token_us / 1000
          : undefined,
      promptEvalDurationMs:
        performance?.prompt_eval_time_us != null
          ? performance.prompt_eval_time_us / 1000
          : undefined,
      promptRunnerDurationMs:
        performance?.prompt_runner_time_us != null
          ? performance.prompt_runner_time_us / 1000
          : undefined,
      generationDurationMs: modelEvalDurationMs ?? generationDurationMs,
      generationTokenCount: modelEvalTokenCount ?? generationTokenCount,
      modelEvalDurationMs,
      modelEvalTokenCount,
      runnerDurationMs,
      runnerTokensPerSecond,
      deliveryDurationMs: hasSeparatedNativeTiming
        ? generationDurationMs
        : undefined,
      deliveryTokenCount: hasSeparatedNativeTiming
        ? generationTokenCount
        : undefined,
      deliveryTokensPerSecond: hasSeparatedNativeTiming
        ? deliveryTokensPerSecond
        : undefined,
      accelerationMode,
      mtpAvailable: mtp?.available,
      mtpRequested: mtp?.requested,
      mtpActive: mtp?.active,
      mtpDirectFallbackSteps: mtp?.direct_fallback_steps,
      mtpDraftTokens: mtp?.draft_tokens,
      mtpAcceptedTokens: mtp?.accepted_tokens,
      mtpDecodeSteps: mtp?.decode_steps,
      mtpAcceptanceRate:
        mtp != null && mtp.draft_tokens > 0
          ? mtp.accepted_tokens / mtp.draft_tokens
          : undefined,
    },
  }
}

export function isDiffusionGemmaModelId(modelId: string | undefined): boolean {
  return /diffusion[-_]?gemma/i.test(modelId ?? '')
}

/**
 * Preserve native AX Engine timing through the OpenAI-compatible SDK layer.
 * Without this extractor the SDK intentionally drops non-standard SSE fields,
 * leaving the UI to time only the near-instant drain of a diffusion block.
 */
export function createAxEngineMetadataExtractor(): MetadataExtractor {
  return {
    extractMetadata: async ({ parsedBody }) => {
      const metrics = readAxEngineWireMetrics(parsedBody)
      return metrics ? providerMetadataForMetrics(metrics) : undefined
    },
    createStreamExtractor: () => {
      let metrics: AxEngineWireMetrics | undefined
      return {
        processChunk(parsedChunk) {
          metrics = readAxEngineWireMetrics(parsedChunk) ?? metrics
        },
        buildMetadata() {
          return metrics ? providerMetadataForMetrics(metrics) : undefined
        },
      }
    },
  }
}

function toMlxParams(req: OpenAIChatRequest): MlxGenerateParams {
  const stop = typeof req.stop === 'string' ? [req.stop] : req.stop
  // OpenAI frequency_penalty is [-2, 2]; MLX repetition_penalty is typically
  // [1.0, ~2.0]. Map and clamp so we never send invalid values.
  let repetition_penalty: number | undefined
  if (req.frequency_penalty != null) {
    const mapped = 1 + req.frequency_penalty
    repetition_penalty = Math.min(2, Math.max(1, mapped))
  }
  return {
    max_output_tokens: req.max_completion_tokens ?? req.max_tokens,
    temperature: req.temperature,
    top_p: req.top_p,
    top_k: req.top_k,
    repetition_penalty,
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
  messages: MlxWireChatMessage[],
  params: MlxGenerateParams,
  signal?: AbortSignal
): Response {
  const encoder = new TextEncoder()
  const created = Math.floor(Date.now() / 1000)
  const id = `mlx-${created}-${Math.random().toString(36).slice(2, 10)}`
  let nativeStreamStarted = false
  let nativeStreamFinished = false
  let cancellationRequested = false

  const cancelNativeStream = async () => {
    cancellationRequested = true
    if (!nativeStreamStarted || nativeStreamFinished) return

    try {
      await invoke<boolean>('mlx_cancel_stream', { requestId: id })
    } catch (error) {
      console.warn('[mlx-ipc-fetch] failed to cancel native stream:', error)
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      await withMlxRequestLock(async () => {
        const channel = new Channel<StreamEvent>()

        let firstDeltaSent = false
        let lastErr: string | null = null
        let streamClosed = false
        let wasCancelled = false

        // Wrap controller writes so we silently no-op if the stream has been
        // closed (e.g. the user navigated away mid-generation). Without this
        // guard a pending setTimeout could call enqueue() on a closed
        // controller and throw.
        const safeEnqueue = (bytes: Uint8Array) => {
          if (streamClosed) return
          try {
            controller.enqueue(bytes)
          } catch {
            streamClosed = true
          }
        }
        const safeClose = () => {
          if (streamClosed) return
          streamClosed = true
          try {
            controller.close()
          } catch {
            /* already closed */
          }
        }
        const safeError = (error: unknown) => {
          if (streamClosed) return
          streamClosed = true
          try {
            controller.error(error)
          } catch {
            /* already closed */
          }
        }
        const handleAbort = () => {
          wasCancelled = true
          safeError(new DOMException('The operation was aborted.', 'AbortError'))
          void cancelNativeStream()
        }

        if (signal?.aborted) {
          handleAbort()
          return
        }
        signal?.addEventListener('abort', handleAbort, { once: true })

        const enqueueChunk = (
          delta: { role?: string; content?: string },
          finish_reason: string | null
        ) => {
          const chunk = {
            id,
            object: 'chat.completion.chunk',
            created,
            model: modelId,
            choices: [{ index: 0, delta, finish_reason }],
          }
          safeEnqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
        }

        channel.onmessage = (evt) => {
          try {
            if (evt.type === 'start') {
              // Send a role-only opening chunk to match OpenAI's SSE shape.
              enqueueChunk({ role: 'assistant' }, null)
              firstDeltaSent = true
            } else if (evt.type === 'delta') {
              if (!firstDeltaSent) {
                enqueueChunk({ role: 'assistant' }, null)
                firstDeltaSent = true
              }
              if (evt.text.length > 0) {
                enqueueChunk({ content: evt.text }, null)
              }
            } else if (evt.type === 'done') {
              nativeStreamFinished = true
              // Preempted / cancelled streams must not be persisted as
              // complete answers (AX-C1). Surface as AbortError so the AI SDK
              // marks the message aborted rather than finalized.
              if (evt.finish_reason === 'cancelled' || wasCancelled) {
                safeError(
                  new DOMException('The operation was aborted.', 'AbortError')
                )
                return
              }
              if (!firstDeltaSent) {
                enqueueChunk({ role: 'assistant' }, null)
                firstDeltaSent = true
              }

              const finalChunk = {
                id,
                object: 'chat.completion.chunk',
                created,
                model: modelId,
                choices: [
                  { index: 0, delta: {}, finish_reason: evt.finish_reason },
                ],
                usage: {
                  prompt_tokens: evt.prompt_token_count,
                  completion_tokens: evt.output_token_count,
                  total_tokens: evt.prompt_token_count + evt.output_token_count,
                },
                ax_engine_metrics: {
                  elapsed_ms: evt.elapsed_ms,
                  output_token_count: evt.output_token_count,
                  generation_kind:
                    evt.performance?.generation_kind ??
                    (isDiffusionGemmaModelId(modelId)
                      ? 'block_diffusion'
                      : 'autoregressive'),
                  performance: evt.performance,
                },
              }

              safeEnqueue(
                encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`)
              )
              safeEnqueue(encoder.encode('data: [DONE]\n\n'))
              safeClose()
            } else if (evt.type === 'error') {
              lastErr = evt.message
              // Don't close yet — the `done` event should still arrive from the
              // worker. If it doesn't, the invoke() rejection below handles it.
            }
          } catch (e) {
            if (!streamClosed) {
              controller.error(e)
              streamClosed = true
            }
          }
        }

        try {
          // Idempotent — Rust resolves the HF cache snapshot from modelId.
          // With the residency check in load(), this no longer cancels
          // in-flight streams for the same model.
          await invoke('mlx_load_model', { modelId })
          if (cancellationRequested || signal?.aborted) return

          nativeStreamStarted = true
          const nativeStream = invoke('mlx_chat_stream', {
            requestId: id,
            modelId,
            messages,
            params,
            onEvent: channel,
          })
          if (cancellationRequested || signal?.aborted) {
            void cancelNativeStream()
          }
          await nativeStream
          nativeStreamFinished = true
          // Defensive: if the channel never delivered `done`, close so the UI
          // does not hang on "thinking" forever.
          if (!streamClosed) {
            safeClose()
          }
        } catch (e) {
          if (lastErr == null)
            lastErr = e instanceof Error ? e.message : String(e)
          // AbortError must stay typed so the SDK treats it as cancellation.
          if (
            (e instanceof DOMException && e.name === 'AbortError') ||
            wasCancelled
          ) {
            safeError(
              new DOMException('The operation was aborted.', 'AbortError')
            )
          } else {
            safeError(new Error(`[mlx-ipc-fetch] ${lastErr}`))
          }
        } finally {
          signal?.removeEventListener('abort', handleAbort)
        }
      })
    },
    async cancel() {
      await cancelNativeStream()
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
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const request =
      typeof Request !== 'undefined' && input instanceof Request
        ? input
        : undefined
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
    if (method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'mlx fetch supports POST only' }),
        {
          status: 405,
          headers: JSON_HEADERS,
        }
      )
    }

    let parsed: OpenAIChatRequest
    try {
      // Fetch callers may provide a Request object instead of a URL + init.
      // Respect an explicit init body when present; otherwise consume the
      // Request body exactly as native fetch would.
      const body =
        init && Object.prototype.hasOwnProperty.call(init, 'body')
          ? init.body
          : request?.body
      const raw =
        typeof body === 'string' ? body : await new Response(body).text()
      parsed = JSON.parse(raw) as OpenAIChatRequest
    } catch (e) {
      console.warn('[mlx-ipc-fetch] failed to parse request body:', e)
      return new Response(
        JSON.stringify({
          error: 'mlx fetch could not parse request body',
        }),
        { status: 400, headers: JSON_HEADERS }
      )
    }

    const modelId = parsed.model
    const { messages, rejectedReason } = sanitizeMessagesForMlx(
      parsed.messages ?? []
    )
    if (rejectedReason) {
      return new Response(JSON.stringify({ error: rejectedReason }), {
        status: 400,
        headers: JSON_HEADERS,
      })
    }
    const params = toMlxParams(parsed)
    const signal = init?.signal ?? request?.signal

    if (signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError')
    }

    if (parsed.stream) {
      return streamingResponse(modelId, messages, params, signal)
    }

    try {
      return await withMlxRequestLock(async () => {
        await invoke('mlx_load_model', { modelId })
        if (signal?.aborted) {
          throw new DOMException('The operation was aborted.', 'AbortError')
        }
        const result = await invoke<MlxChatCompletion>('mlx_chat_completion', {
          modelId,
          messages,
          params,
        })
        return nonStreamResponse(result)
      })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        throw e
      }
      const message = e instanceof Error ? e.message : String(e)
      return new Response(
        JSON.stringify({ error: `[mlx-ipc-fetch] ${message}` }),
        { status: 500, headers: JSON_HEADERS }
      )
    }
  } as typeof fetch
}
