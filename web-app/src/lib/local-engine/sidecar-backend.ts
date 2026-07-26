import { isPlatformElectron } from '@/lib/platform/utils'
import { createLifecycle } from './phases'
import type { LocalEngineBackend, LocalEngineLifecycle, LocalEnginePhase } from './types'

/** Registry status payload returned by the Electron main-process manager. */
interface AxEngineStatusPayload {
  phase: LocalEnginePhase
  baseURL: string | null
  apiKey: string | null
  models?: string[]
  detail?: string
}

export const AX_ENGINE_SIDECAR_DEFAULT_BASE_URL = 'http://127.0.0.1:31418/v1'
export const AX_ENGINE_SIDECAR_DEFAULT_API_KEY = 'local'

const PHASE_BLOCKER: Record<LocalEnginePhase, string | null> = {
  ready: null,
  starting: 'studio.sidecar.starting',
  degraded: 'studio.sidecar.degraded',
  missing_model: 'studio.sidecar.missing_model',
  missing_dependency: 'studio.sidecar.missing_dependency',
  unavailable: 'studio.sidecar.unavailable',
  error: 'studio.sidecar.error',
}

/**
 * Managed `ax-engine serve` over OpenAI-compatible HTTP (macOS sidecar).
 *
 * In the Electron shell the main process owns the binary lifecycle
 * (`ax_engine_status` / `ax_engine_ensure` / … registry commands); this class
 * is the renderer façade over that bridge. Outside Electron it degrades to a
 * plain HTTP probe against a caller-provided baseURL.
 */
export class SidecarHttpLocalEngineBackend implements LocalEngineBackend {
  readonly info = {
    kind: 'sidecar_http' as const,
    providerId: 'ax-engine',
    label: 'AX Engine (sidecar HTTP)',
  }

  constructor(
    private readonly options: {
      baseURL?: string
      /** When false, probe reports missing_dependency instead of attempting fetch. */
      enabled?: boolean
    } = {},
  ) {}

  private baseURL(): string {
    const raw = this.options.baseURL?.trim() || AX_ENGINE_SIDECAR_DEFAULT_BASE_URL
    return raw.replace(/\/+$/, '')
  }

  private async invokeStatus(): Promise<AxEngineStatusPayload> {
    const { invoke } = await import('@/lib/tauri-shim/api-core')
    return (await invoke('ax_engine_status')) as AxEngineStatusPayload
  }

  private lifecycleFromStatus(status: AxEngineStatusPayload): LocalEngineLifecycle {
    const blocker = PHASE_BLOCKER[status.phase]
    return createLifecycle(
      'sidecar_http',
      status.phase,
      blocker ? [blocker] : [],
      status.detail ?? status.baseURL ?? undefined,
    )
  }

  async probe(): Promise<LocalEngineLifecycle> {
    if (this.options.enabled === false) {
      return createLifecycle(
        'sidecar_http',
        'missing_dependency',
        ['studio.sidecar.disabled'],
        'Sidecar backend is not enabled in this build.',
      )
    }

    if (isPlatformElectron()) {
      try {
        return this.lifecycleFromStatus(await this.invokeStatus())
      } catch (error) {
        return createLifecycle(
          'sidecar_http',
          'error',
          ['studio.sidecar.status_failed'],
          error instanceof Error ? error.message : String(error),
        )
      }
    }

    const baseURL = this.baseURL()
    try {
      const response = await fetch(`${baseURL}/models`, {
        headers: { Authorization: `Bearer ${AX_ENGINE_SIDECAR_DEFAULT_API_KEY}` },
        signal: AbortSignal.timeout(2000),
      })
      if (!response.ok) {
        response.body?.cancel()
        return createLifecycle(
          'sidecar_http',
          'error',
          ['studio.sidecar.health_http'],
          `HTTP ${response.status}`,
        )
      }
      return createLifecycle('sidecar_http', 'ready', [], baseURL)
    } catch (error) {
      return createLifecycle(
        'sidecar_http',
        'missing_dependency',
        ['studio.sidecar.unreachable'],
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  async ensureReady(options?: {
    modelId?: string
    signal?: AbortSignal
  }): Promise<LocalEngineLifecycle> {
    if (isPlatformElectron() && this.options.enabled !== false) {
      if (options?.signal?.aborted) {
        return createLifecycle('sidecar_http', 'error', ['studio.sidecar.aborted'], 'aborted')
      }
      if (!options?.modelId) return this.probe()
      try {
        const { invoke } = await import('@/lib/tauri-shim/api-core')
        // ax-engine serve accepts a model path OR an alias; the Electron main
        // process resolves binary, port, posture and readiness.
        const status = (await invoke('ax_engine_ensure', {
          modelPath: options?.modelId,
          modelId: options?.modelId,
        })) as AxEngineStatusPayload
        if (options?.signal?.aborted) {
          return createLifecycle('sidecar_http', 'error', ['studio.sidecar.aborted'], 'aborted')
        }
        return this.lifecycleFromStatus(status)
      } catch (error) {
        return createLifecycle(
          'sidecar_http',
          'error',
          ['studio.sidecar.ensure_failed'],
          error instanceof Error ? error.message : String(error),
        )
      }
    }
    // Non-Electron fallback: the server must be started externally.
    return this.probe()
  }

  /** The sidecar speaks plain OpenAI-compatible HTTP — native fetch suffices. */
  createChatFetch(): typeof fetch {
    return globalThis.fetch.bind(globalThis)
  }
}
