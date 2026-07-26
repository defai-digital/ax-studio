// ax-engine sidecar command handlers (macOS). Plain `ax_engine_*` names in
// the same style as the other first-party bridges (start_server, …).
import { str } from './args.js'
import type { CommandHandler } from './registry.js'
import {
  ensureAxEngine,
  getAxEngineStatus,
  loadAxEngineModel,
  unloadAxEngineModel,
  stopAxEngine,
  type EnsureAxEngineOptions,
} from '../ax-engine/server.js'
import type { AxEnginePosture } from '../ax-engine/types.js'

type Args = Record<string, unknown>

function requiredStr(args: Args | undefined, ...names: string[]): string {
  for (const name of names) {
    const value = str(args?.[name])
    if (value) return value
  }
  throw new Error(`Invalid argument: missing ${names.join('/')}`)
}

function optionalNumber(args: Args | undefined, ...names: string[]): number | undefined {
  for (const name of names) {
    const value = args?.[name]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function stringRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const record: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value as Args)) {
    if (typeof entry === 'string') record[key] = entry
  }
  return record
}

function postureArg(value: unknown): Partial<Omit<AxEnginePosture, 'modelId'>> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Args
  const out: Record<string, unknown> = {}
  for (const key of [
    'contextTokens',
    'speculationProfile',
    'maxBatchTokens',
    'disableNgramAcceleration',
    'maxConcurrentRequests',
    'mlxMtpDisableNgramStacking',
    'blockSizeTokens',
  ] as const) {
    if (raw[key] !== undefined) out[key] = raw[key]
  }
  return out as Partial<Omit<AxEnginePosture, 'modelId'>>
}

function ensureOptions(args: Args | undefined): EnsureAxEngineOptions {
  return {
    modelPath: requiredStr(args, 'modelPath', 'model_path'),
    modelId: str(args?.modelId) ?? str(args?.model_id),
    posture: postureArg(args?.posture),
    binaryPath: str(args?.binaryPath) ?? str(args?.binary_path),
    apiKey: str(args?.apiKey) ?? str(args?.api_key),
    envs: stringRecord(args?.envs),
    readinessTimeoutMs: optionalNumber(args, 'readinessTimeoutMs', 'readiness_timeout_ms'),
  }
}

export function createAxEngineHandlers(): Record<string, CommandHandler> {
  return {
    // Phase + baseURL + loaded models + binary resolution detail.
    ax_engine_status: (args) =>
      getAxEngineStatus(str(args?.binaryPath) ?? str(args?.binary_path)),
    // Binary present? Start (or reuse/reclaim) the server for a model+posture.
    ax_engine_ensure: (args) => ensureAxEngine(ensureOptions(args)),
    ax_engine_load_model: (args) =>
      loadAxEngineModel(
        requiredStr(args, 'modelId', 'model_id'),
        requiredStr(args, 'modelPath', 'model_path'),
        args?.makeDefault !== false && args?.make_default !== false,
      ),
    ax_engine_unload_model: (args) =>
      unloadAxEngineModel(requiredStr(args, 'modelId', 'model_id')),
    ax_engine_stop: (args) => stopAxEngine(optionalNumber(args, 'graceMs', 'grace_ms')),
  }
}
