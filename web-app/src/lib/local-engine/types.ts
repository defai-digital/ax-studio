/**
 * Shared Local Engine client contract (aligned with ax-engine
 * docs/LOCAL-ENGINE-CLIENTS.md and AX Code lifecycle mapping).
 */

/** Closed set of readiness phases for first-party engine clients. */
export type LocalEnginePhase =
  | 'unavailable'
  | 'missing_dependency'
  | 'missing_model'
  | 'starting'
  | 'ready'
  | 'degraded'
  | 'error'

/** How the product executes ax-engine work. */
export type LocalEngineBackendKind = 'in_process' | 'sidecar_http'

export const LOCAL_ENGINE_PHASE_RANK: Record<LocalEnginePhase, number> = {
  error: 60,
  unavailable: 50,
  missing_dependency: 40,
  missing_model: 30,
  starting: 20,
  degraded: 10,
  ready: 0,
}

export interface LocalEngineBackendInfo {
  kind: LocalEngineBackendKind
  /** Product provider id, e.g. `mlx` or `ax-engine`. */
  providerId: string
  /** Human label for settings / diagnostics. */
  label: string
}

export interface LocalEngineLifecycle {
  phase: LocalEnginePhase
  backend: LocalEngineBackendKind
  /** Machine-readable blockers (error codes or short reasons). */
  blockers: string[]
  /** Optional free-form detail for logs/UI. */
  detail?: string
}

/**
 * Product-facing backend operations. Concrete backends may no-op methods that
 * do not apply (e.g. installBinary for in-process SDK embeds).
 */
export interface LocalEngineBackend {
  readonly info: LocalEngineBackendInfo
  probe(): Promise<LocalEngineLifecycle>
  ensureReady(options?: { modelId?: string; signal?: AbortSignal }): Promise<LocalEngineLifecycle>
  /** OpenAI-compatible fetch façade used by chat transports, when applicable. */
  createChatFetch?(): typeof fetch
}
