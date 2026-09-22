// Shared types for the ax-engine sidecar manager. Lifecycle phase literals
// follow the cross-product contract in ax-engine docs/LOCAL-ENGINE-CLIENTS.md
// (aligned with AX Code's packages/ax-code/src/provider/ax-engine/).

export type AxEnginePhase =
  | 'unavailable'
  | 'missing_dependency'
  | 'missing_model'
  | 'starting'
  | 'ready'
  | 'degraded'
  | 'error'

export const AX_ENGINE_BACKEND_KIND = 'sidecar_http' as const

/**
 * Native MTP admission policy, forwarded verbatim as
 * `ax-engine serve --mlx-mtp-policy <value>`.
 *
 * The default is `required` because neither of the engine's other settings can
 * turn MTP on for the packs this app serves locally:
 *
 *  - `auto` does not promote the unqualified linear-Qwen Tiel packs
 *    (ax-engine docs/CLI.md: "The default `auto` policy does not promote these
 *    unqualified linear-Qwen packs. serve with `--mlx-mtp-policy required`").
 *  - this posture also sends `--disable-ngram-acceleration`, and the engine
 *    demotes `auto` to `disabled` whenever that flag is present
 *    (crates/ax-engine-server/src/args/session.rs).
 *
 * Callers serving a pack without an admitted drafter must pass `auto` or
 * `disabled`: `required` rejects session creation outright.
 */
export type AxEngineMtpPolicy = 'auto' | 'disabled' | 'required'

/** Launch posture: flags that require a full respawn when they change. */
export interface AxEnginePosture {
  modelId: string
  /** Total context window in tokens; served as total-blocks × block-size-tokens. */
  contextTokens: number
  speculationProfile: string
  maxBatchTokens: number
  disableNgramAcceleration: boolean
  maxConcurrentRequests: number
  mlxMtpPolicy: AxEngineMtpPolicy
  mlxMtpDisableNgramStacking: boolean
  blockSizeTokens: number
}

export const DEFAULT_POSTURE: Omit<AxEnginePosture, 'modelId'> = {
  contextTokens: 16384,
  speculationProfile: 'agentic',
  maxBatchTokens: 2048,
  disableNgramAcceleration: true,
  maxConcurrentRequests: 1,
  mlxMtpPolicy: 'required',
  mlxMtpDisableNgramStacking: false,
  blockSizeTokens: 16,
}

/** Canonical JSON (fixed key order) used for posture equality in server.json. */
export function canonicalPosture(posture: AxEnginePosture): string {
  return JSON.stringify({
    modelId: posture.modelId,
    contextTokens: posture.contextTokens,
    speculationProfile: posture.speculationProfile,
    maxBatchTokens: posture.maxBatchTokens,
    disableNgramAcceleration: posture.disableNgramAcceleration,
    maxConcurrentRequests: posture.maxConcurrentRequests,
    mlxMtpPolicy: posture.mlxMtpPolicy,
    mlxMtpDisableNgramStacking: posture.mlxMtpDisableNgramStacking,
    blockSizeTokens: posture.blockSizeTokens,
  })
}

/** On-disk record written BEFORE the readiness wait (orphan-reclaim source). */
export interface AxEngineServerRecord {
  pid: number
  port: number
  baseURL: string
  apiKey: string
  model: string
  modelPath: string
  models: string[]
  posture: string
  binaryPath: string
  version: string | null
  startedAt: string
}

export type AxEngineBinarySource = 'override' | 'env' | 'path' | 'managed'

export interface AxEngineStatus {
  phase: AxEnginePhase
  backend: typeof AX_ENGINE_BACKEND_KIND
  baseURL: string | null
  port: number | null
  pid: number | null
  models: string[]
  binaryPath: string | null
  binarySource: AxEngineBinarySource | null
  version: string | null
  apiKey: string | null
  warnings: string[]
  detail?: string
  /** Last ~8 KiB / 40 lines of server.log, surfaced on error. */
  logTail?: string
}

export interface AxEngineStopResult {
  success: boolean
  /** True when there was no live server to stop (or the record was stale). */
  stale?: boolean
  signal?: 'SIGTERM' | 'SIGKILL' | 'none'
  error?: string
}
