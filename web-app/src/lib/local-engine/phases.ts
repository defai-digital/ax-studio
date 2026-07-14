import {
  LOCAL_ENGINE_PHASE_RANK,
  type LocalEngineLifecycle,
  type LocalEnginePhase,
  type LocalEngineBackendKind,
} from './types'

/** Pick the most severe phase from a list (error > … > ready). */
export function mostSeverePhase(phases: LocalEnginePhase[]): LocalEnginePhase {
  if (phases.length === 0) return 'ready'
  return phases.reduce((best, next) =>
    LOCAL_ENGINE_PHASE_RANK[next] > LOCAL_ENGINE_PHASE_RANK[best] ? next : best,
  )
}

export function createLifecycle(
  backend: LocalEngineBackendKind,
  phase: LocalEnginePhase,
  blockers: string[] = [],
  detail?: string,
): LocalEngineLifecycle {
  return {
    phase,
    backend,
    blockers: blockers.filter(Boolean),
    detail,
  }
}

/**
 * Derive a lifecycle phase from coarse host signals (shared by Studio UI/tests).
 * Mirrors the severity rules in ax-engine docs/LOCAL-ENGINE-CLIENTS.md.
 */
export function derivePhaseFromSignals(input: {
  platformSupported: boolean
  dependencyReady: boolean
  modelPrepared: boolean
  starting?: boolean
  runtimeReady: boolean
  hardError?: boolean
  degraded?: boolean
}): LocalEnginePhase {
  const candidates: LocalEnginePhase[] = []
  if (input.hardError) candidates.push('error')
  if (!input.platformSupported) candidates.push('unavailable')
  if (!input.dependencyReady) candidates.push('missing_dependency')
  if (!input.modelPrepared) candidates.push('missing_model')
  if (input.starting) candidates.push('starting')
  if (input.runtimeReady && input.degraded) candidates.push('degraded')
  if (input.runtimeReady) candidates.push('ready')
  if (candidates.length === 0) candidates.push('starting')
  return mostSeverePhase(candidates)
}
