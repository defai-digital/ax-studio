/**
 * AX Engine wire-metrics parsing + AI SDK metadata extraction.
 *
 * Pure module — no Tauri IPC imports — so the Electron build (which talks to
 * the `ax-engine serve` sidecar over HTTP) can use the metadata extractor and
 * model-id helpers without bundling the in-process MLX IPC fetch shim
 * (`mlx-ipc-fetch.ts`, Tauri-only). The shim re-exports the public helpers
 * for backward compatibility.
 */
import type { MetadataExtractor } from '@ai-sdk/openai-compatible'

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

export interface AxEnginePerformanceWireMetrics {
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
