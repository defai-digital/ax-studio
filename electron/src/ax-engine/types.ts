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

/** Launch posture: flags that require a full respawn when they change. */
export interface AxEnginePosture {
  modelId: string
  /** Total context window in tokens; served as total-blocks × block-size-tokens. */
  contextTokens: number
  speculationProfile: string
  maxBatchTokens: number
  disableNgramAcceleration: boolean
  maxConcurrentRequests: number
  mlxMtpDisableNgramStacking: boolean
  blockSizeTokens: number
}

export const DEFAULT_POSTURE: Omit<AxEnginePosture, 'modelId'> = {
  contextTokens: 16384,
  speculationProfile: 'agentic',
  maxBatchTokens: 2048,
  disableNgramAcceleration: true,
  maxConcurrentRequests: 1,
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
