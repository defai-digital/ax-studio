import { createLifecycle } from './phases'
import type { LocalEngineBackend, LocalEngineLifecycle } from './types'

/**
 * Optional future backend: managed `ax-engine serve` over OpenAI-compatible HTTP.
 *
 * AX Studio does **not** enable this by default (see ADR-009). The class exists
 * so product code can share lifecycle vocabulary with AX Code and so a later
 * settings toggle can plug in without inventing a new protocol.
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
    const raw = this.options.baseURL?.trim() || 'http://127.0.0.1:18181/v1'
    return raw.replace(/\/+$/, '')
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

    const baseURL = this.baseURL()
    try {
      const response = await fetch(`${baseURL}/models`, {
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

  async ensureReady(): Promise<LocalEngineLifecycle> {
    // Studio does not yet manage binary install/spawn (AX Code does). Callers
    // that enable sidecar must start the server externally until that lands.
    return this.probe()
  }
}
