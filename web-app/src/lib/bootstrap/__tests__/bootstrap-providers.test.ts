import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/providers/provider-sync', () => ({
  syncRemoteProviders: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ax-bi/direct-client', () => ({
  probeAxBiDirectConnection: vi.fn().mockResolvedValue(undefined),
}))

import {
  bootstrapProviders,
  type BootstrapProvidersInput,
} from '../bootstrap-providers'
import { syncRemoteProviders } from '@/lib/providers/provider-sync'
import { probeAxBiDirectConnection } from '@/lib/ax-bi/direct-client'

function makeServiceHub(overrides: Record<string, unknown> = {}) {
  return {
    providers: () => ({
      getProviders: vi
        .fn()
        .mockResolvedValue([{ id: 'p1', provider: 'openai', name: 'OpenAI' }]),
      ...((overrides.providers as Record<string, unknown>) ?? {}),
    }),
    path: () => ({
      sep: () => '/',
    }),
  }
}

function makeInput(
  overrides: Partial<BootstrapProvidersInput> = {}
): BootstrapProvidersInput {
  return {
    serviceHub:
      makeServiceHub() as unknown as BootstrapProvidersInput['serviceHub'],
    setProviders: vi.fn(),
    ...overrides,
  }
}

describe('bootstrapProviders', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    consoleWarnSpy.mockRestore()
  })

  it('returns ok result on success', async () => {
    const input = makeInput()
    const { result } = await bootstrapProviders(input)
    expect(result).toEqual({ ok: true })
  })

  it('calls setProviders with loaded providers', async () => {
    const setProviders = vi.fn()
    const input = makeInput({ setProviders })

    await bootstrapProviders(input)

    expect(setProviders).toHaveBeenCalledWith(
      [{ id: 'p1', provider: 'openai', name: 'OpenAI' }],
      '/'
    )
  })

  it('does not sync a provider snapshot rejected by the caller', async () => {
    const setProviders = vi.fn().mockReturnValue(false)

    await bootstrapProviders(makeInput({ setProviders }))

    expect(setProviders).toHaveBeenCalledOnce()
    expect(vi.mocked(syncRemoteProviders)).not.toHaveBeenCalled()
  })

  it('warms the AX BI direct connection in the background', async () => {
    await bootstrapProviders(makeInput())

    expect(vi.mocked(probeAxBiDirectConnection)).toHaveBeenCalled()
  })

  it('continues when providers fail to load', async () => {
    const hub = makeServiceHub({
      providers: {
        getProviders: vi.fn().mockRejectedValue(new Error('network error')),
      },
    })
    const setProviders = vi.fn()
    const input = makeInput({
      serviceHub: hub as unknown as BootstrapProvidersInput['serviceHub'],
      setProviders,
    })

    const { result } = await bootstrapProviders(input)

    // The function catches provider errors internally
    expect(result).toEqual({ ok: true })
    expect(setProviders).not.toHaveBeenCalled()
  })

  it('does not apply bootstrap data after cancellation', async () => {
    let resolveProviders!: (providers: ModelProvider[]) => void
    const getProviders = vi.fn(
      () =>
        new Promise<ModelProvider[]>((resolve) => {
          resolveProviders = resolve
        })
    )
    const hub = makeServiceHub({ providers: { getProviders } })
    const setProviders = vi.fn()
    let cancelled = false
    const work = bootstrapProviders(
      makeInput({
        serviceHub: hub as unknown as BootstrapProvidersInput['serviceHub'],
        setProviders,
        isCancelled: () => cancelled,
      })
    )

    cancelled = true
    resolveProviders([])
    await work

    expect(setProviders).not.toHaveBeenCalled()
    expect(vi.mocked(probeAxBiDirectConnection)).not.toHaveBeenCalled()
  })

  it('returns fail result when outer try/catch catches', async () => {
    const badHub = {
      providers: () => {
        throw new Error('sync kaboom')
      },
      path: () => ({ sep: () => '/' }),
    }
    const input = makeInput({
      serviceHub: badHub as unknown as BootstrapProvidersInput['serviceHub'],
    })

    const { result } = await bootstrapProviders(input)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error)
    }
  })
})
