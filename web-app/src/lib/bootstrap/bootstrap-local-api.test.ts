import { describe, it, expect, vi, beforeEach } from 'vitest'
import { bootstrapLocalApi } from './bootstrap-local-api'
import type { BootstrapLocalApiInput } from './bootstrap-local-api'

const makeServiceHub = (isRunning = false, shouldFail = false) => ({
  app: () => ({
    getServerStatus: shouldFail
      ? vi.fn().mockRejectedValue(new Error('status check failed'))
      : vi.fn().mockResolvedValue(isRunning),
  }),
})

const defaultConfig = {
  host: 'localhost',
  port: 39291,
  prefix: '/api',
  apiKey: 'test-key',
  trustedHosts: [],
  corsEnabled: false,
  verboseLogs: false,
  proxyTimeout: 30000,
}

const makeInput = (overrides: Partial<BootstrapLocalApiInput> = {}): BootstrapLocalApiInput => ({
  serviceHub: makeServiceHub() as any,
  enabled: true,
  config: defaultConfig,
  setServerStatus: vi.fn(),
  setServerPort: vi.fn(),
  ...overrides,
})

beforeEach(() => {
  // Reset window.core
  ;(globalThis as any).window = { core: { api: { startServer: vi.fn().mockResolvedValue(39291) } } }
})

describe('bootstrapLocalApi', () => {
  it('returns ok immediately when disabled', async () => {
    const input = makeInput({ enabled: false })
    const result = await bootstrapLocalApi(input)
    expect(result).toEqual({ ok: true })
    expect(input.setServerStatus).not.toHaveBeenCalled()
  })

  it('sets status to running when server is already running', async () => {
    const input = makeInput({ serviceHub: makeServiceHub(true) as any })
    const result = await bootstrapLocalApi(input)
    expect(result).toEqual({ ok: true })
    expect(input.setServerStatus).toHaveBeenCalledWith('running')
  })

  it('starts server and sets status to running when not already running', async () => {
    const input = makeInput({ serviceHub: makeServiceHub(false) as any })
    const result = await bootstrapLocalApi(input)
    expect(result).toEqual({ ok: true })
    expect(input.setServerStatus).toHaveBeenCalledWith('pending')
    expect(input.setServerStatus).toHaveBeenCalledWith('running')
  })

  it('updates port when server returns a different port', async () => {
    ;(globalThis as any).window.core.api.startServer = vi.fn().mockResolvedValue(40000)
    const input = makeInput({ serviceHub: makeServiceHub(false) as any })
    await bootstrapLocalApi(input)
    expect(input.setServerPort).toHaveBeenCalledWith(40000)
  })

  it('does not update port when server returns same port', async () => {
    ;(globalThis as any).window.core.api.startServer = vi.fn().mockResolvedValue(39291)
    const input = makeInput({ serviceHub: makeServiceHub(false) as any })
    await bootstrapLocalApi(input)
    expect(input.setServerPort).not.toHaveBeenCalled()
  })

  it('sets status to stopped and returns ok: false when getServerStatus throws', async () => {
    const input = makeInput({ serviceHub: makeServiceHub(false, true) as any })
    const result = await bootstrapLocalApi(input)
    expect(result.ok).toBe(false)
    expect(input.setServerStatus).toHaveBeenCalledWith('stopped')
  })
})
