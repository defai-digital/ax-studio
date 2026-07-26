/**
 * Pure helpers + invoke wrappers for the Electron ax-engine sidecar lifecycle.
 * Keeps ModelsService free of inline protocol details so unit tests can target
 * the real entry points.
 */

import { invoke } from '@/lib/tauri-shim/api-core'
import type { SessionInfo } from '@ax-studio/core'

export type AxEngineStatusPayload = {
  phase?: string
  baseURL?: string | null
  apiKey?: string | null
  models?: string[]
  port?: number | null
  pid?: number | null
  detail?: string
}

export const AX_ENGINE_READY_PHASES = new Set(['ready', 'degraded'])

/**
 * Resolve a model id to a loadable filesystem path when possible.
 * Falls back to the model id (alias / path) if resolution is unavailable.
 */
export async function resolveAxEngineModelPath(modelId: string): Promise<string> {
  try {
    const resolved = await invoke<string>('mlx_resolve_model_dir', {
      modelId,
      model_id: modelId,
    })
    if (typeof resolved === 'string' && resolved.trim().length > 0) {
      return resolved
    }
  } catch {
    // Alias or path that serve can resolve directly.
  }
  return modelId
}

export function sessionFromAxEngineStatus(
  modelId: string,
  modelPath: string,
  status: AxEngineStatusPayload
): SessionInfo {
  return {
    pid: typeof status.pid === 'number' ? status.pid : 0,
    port: typeof status.port === 'number' ? status.port : 0,
    model_id: modelId,
    model_path: modelPath,
    is_embedding: false,
    api_key: status.apiKey ?? '',
  }
}

/**
 * Ensure the managed sidecar has `modelId` loaded. Throws when ensure returns
 * a non-ready phase.
 */
export async function ensureAxEngineSidecarModel(
  modelId: string
): Promise<{ status: AxEngineStatusPayload; modelPath: string }> {
  const modelPath = await resolveAxEngineModelPath(modelId)
  const status = (await invoke('ax_engine_ensure', {
    modelPath,
    model_path: modelPath,
    modelId,
    model_id: modelId,
  })) as AxEngineStatusPayload

  const phase = status?.phase ?? 'error'
  if (!AX_ENGINE_READY_PHASES.has(phase)) {
    throw new Error(
      status?.detail ||
        `ax-engine ensure failed (phase=${phase}) for model "${modelId}"`
    )
  }
  return { status, modelPath }
}

export async function unloadAxEngineSidecarModel(
  modelId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await invoke('ax_engine_unload_model', {
      modelId,
      model_id: modelId,
    })
    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function listAxEngineSidecarModels(): Promise<string[]> {
  try {
    const status = (await invoke('ax_engine_status')) as AxEngineStatusPayload
    return Array.isArray(status?.models) ? status.models.filter(Boolean) : []
  } catch {
    return []
  }
}
