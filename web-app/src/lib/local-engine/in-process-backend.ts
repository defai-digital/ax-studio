import { createMlxIpcFetch } from '@/lib/mlx-ipc-fetch'
import { createLifecycle, derivePhaseFromSignals } from './phases'
import type { LocalEngineBackend, LocalEngineLifecycle } from './types'

/**
 * Default AX Studio MLX backend: ax-engine-sdk linked into the Tauri host,
 * exposed to the web layer as an OpenAI-shaped fetch via mlx-ipc-fetch.
 *
 * This intentionally does **not** spawn ax-engine-server.
 */
export class InProcessLocalEngineBackend implements LocalEngineBackend {
  readonly info = {
    kind: 'in_process' as const,
    providerId: 'mlx',
    label: 'AX Engine (in-process MLX)',
  }

  async probe(): Promise<LocalEngineLifecycle> {
    // Browser unit tests / non-Tauri: treat as dependency gap unless probe works.
    const isTauri =
      typeof window !== 'undefined' &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Boolean((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__)

    if (!isTauri) {
      return createLifecycle(
        'in_process',
        'missing_dependency',
        ['studio.in_process.requires_tauri'],
        'In-process MLX requires the Tauri host (ax-engine-sdk worker).',
      )
    }

    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const probe = (await invoke('mlx_runtime_probe')) as {
        host?: { supported_mlx_runtime?: boolean }
        metal?: { fully_available?: boolean }
      }
      const platformSupported = Boolean(probe?.host?.supported_mlx_runtime)
      const dependencyReady = Boolean(probe?.metal?.fully_available)
      const phase = derivePhaseFromSignals({
        platformSupported,
        dependencyReady,
        modelPrepared: true, // model selection is separate from runtime probe
        runtimeReady: platformSupported && dependencyReady,
      })
      return createLifecycle(
        'in_process',
        phase,
        phase === 'ready' ? [] : ['studio.mlx.runtime_not_ready'],
      )
    } catch (error) {
      return createLifecycle(
        'in_process',
        'error',
        ['studio.mlx.probe_failed'],
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  async ensureReady(options?: {
    modelId?: string
    signal?: AbortSignal
  }): Promise<LocalEngineLifecycle> {
    const lifecycle = await this.probe()
    if (lifecycle.phase === 'unavailable' || lifecycle.phase === 'missing_dependency') {
      return lifecycle
    }
    if (!options?.modelId) {
      return lifecycle
    }
    if (options.signal?.aborted) {
      return createLifecycle('in_process', 'error', ['studio.mlx.aborted'], 'aborted')
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('mlx_load_model', { modelId: options.modelId, modelDir: null })
      return createLifecycle('in_process', 'ready', [], `loaded:${options.modelId}`)
    } catch (error) {
      return createLifecycle(
        'in_process',
        'error',
        ['studio.mlx.load_failed'],
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  createChatFetch(): typeof fetch {
    return createMlxIpcFetch()
  }
}

/** Factory used by settings/diagnostics; default backend for Studio. */
export function createDefaultLocalEngineBackend(): LocalEngineBackend {
  return new InProcessLocalEngineBackend()
}
