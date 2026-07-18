import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  createLifecycle,
  derivePhaseFromSignals,
  mostSeverePhase,
  InProcessLocalEngineBackend,
  SidecarHttpLocalEngineBackend,
  createDefaultLocalEngineBackend,
  LOCAL_ENGINE_PHASE_RANK,
} from '@/lib/local-engine'

describe('local-engine phases', () => {
  it('ranks error above ready', () => {
    expect(LOCAL_ENGINE_PHASE_RANK.error).toBeGreaterThan(LOCAL_ENGINE_PHASE_RANK.ready)
    expect(mostSeverePhase(['ready', 'missing_model', 'error'])).toBe('error')
    expect(mostSeverePhase(['starting', 'missing_dependency'])).toBe('missing_dependency')
  })

  it('derives phases from host signals using shared severity rules', () => {
    expect(
      derivePhaseFromSignals({
        platformSupported: false,
        dependencyReady: false,
        modelPrepared: false,
        runtimeReady: false,
      }),
    ).toBe('unavailable')

    expect(
      derivePhaseFromSignals({
        platformSupported: true,
        dependencyReady: false,
        modelPrepared: true,
        runtimeReady: false,
      }),
    ).toBe('missing_dependency')

    expect(
      derivePhaseFromSignals({
        platformSupported: true,
        dependencyReady: true,
        modelPrepared: false,
        runtimeReady: false,
      }),
    ).toBe('missing_model')

    expect(
      derivePhaseFromSignals({
        platformSupported: true,
        dependencyReady: true,
        modelPrepared: true,
        runtimeReady: true,
        degraded: true,
      }),
    ).toBe('degraded')

    expect(
      derivePhaseFromSignals({
        platformSupported: true,
        dependencyReady: true,
        modelPrepared: true,
        runtimeReady: true,
      }),
    ).toBe('ready')
  })

  it('creates lifecycle records with backend kind', () => {
    expect(createLifecycle('in_process', 'ready')).toEqual({
      phase: 'ready',
      backend: 'in_process',
      blockers: [],
      detail: undefined,
    })
  })
})

describe('InProcessLocalEngineBackend', () => {
  it('is the studio default and uses mlx provider id', () => {
    const backend = createDefaultLocalEngineBackend()
    expect(backend).toBeInstanceOf(InProcessLocalEngineBackend)
    expect(backend.info.kind).toBe('in_process')
    expect(backend.info.providerId).toBe('mlx')
  })

  it('reports missing_dependency outside Tauri', async () => {
    const backend = new InProcessLocalEngineBackend()
    const lifecycle = await backend.probe()
    expect(lifecycle.backend).toBe('in_process')
    expect(lifecycle.phase).toBe('missing_dependency')
    expect(lifecycle.blockers).toContain('studio.in_process.requires_tauri')
  })

  it('exposes OpenAI-shaped chat fetch from mlx ipc façade', () => {
    const backend = new InProcessLocalEngineBackend()
    const fetchFn = backend.createChatFetch?.()
    expect(typeof fetchFn).toBe('function')
  })
})

describe('SidecarHttpLocalEngineBackend', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports disabled when not enabled', async () => {
    const backend = new SidecarHttpLocalEngineBackend({ enabled: false })
    const lifecycle = await backend.probe()
    expect(lifecycle.backend).toBe('sidecar_http')
    expect(lifecycle.phase).toBe('missing_dependency')
    expect(lifecycle.blockers).toContain('studio.sidecar.disabled')
  })

  it('marks ready when /models responds ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      }),
    )
    const backend = new SidecarHttpLocalEngineBackend({
      enabled: true,
      baseURL: 'http://127.0.0.1:18181/v1',
    })
    const lifecycle = await backend.probe()
    expect(lifecycle.phase).toBe('ready')
    expect(lifecycle.detail).toContain('18181')
  })

  it('maps network failure to missing_dependency', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    )
    const backend = new SidecarHttpLocalEngineBackend({ enabled: true })
    const lifecycle = await backend.probe()
    expect(lifecycle.phase).toBe('missing_dependency')
    expect(lifecycle.blockers).toContain('studio.sidecar.unreachable')
  })
})
