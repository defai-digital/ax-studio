import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
import { bootstrapLocalApi } from '../bootstrap-local-api'
import type { BootstrapLocalApiInput } from '../bootstrap-local-api'

const makeServiceHub = (isRunning = false, shouldFail = false) => ({
  app: () => ({
    getServerStatus: shouldFail
      ? vi.fn().mockRejectedValue(new Error('status check failed'))
      : vi.fn().mockResolvedValue(isRunning),
  }),
})

let consoleErrorSpy: ReturnType<typeof vi.spyOn>
let consoleInfoSpy: ReturnType<typeof vi.spyOn>
let consoleWarnSpy: ReturnType<typeof vi.spyOn>

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
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  // Reset window.core
  ;(globalThis as any).window = {
    core: {
      api: {
        startServer: vi.fn().mockResolvedValue(39291),
        stopServer: vi.fn().mockResolvedValue(undefined),
      },
    },
  }
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ status: 200 })
  )
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
  consoleInfoSpy.mockRestore()
  consoleWarnSpy.mockRestore()
  vi.unstubAllGlobals()
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
    expect((globalThis as any).fetch).toHaveBeenCalledWith(
      'http://localhost:39291/api/models',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-key' },
        method: 'GET',
      })
    )
    expect((globalThis as any).window.core.api.startServer).not.toHaveBeenCalled()
  })

  it('restarts an already-running server when its token is stale', async () => {
    ;(globalThis as any).fetch = vi.fn().mockResolvedValue({ status: 401 })
    const input = makeInput({ serviceHub: makeServiceHub(true) as any })

    const result = await bootstrapLocalApi(input)

    expect(result).toEqual({ ok: true })
    expect((globalThis as any).window.core.api.stopServer).toHaveBeenCalledTimes(1)
    expect((globalThis as any).window.core.api.startServer).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'test-key' })
    )
    expect(input.setServerStatus).toHaveBeenCalledWith('pending')
    expect(input.setServerStatus).toHaveBeenLastCalledWith('running')
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

  it('tries the next port when the configured port is already in use', async () => {
    ;(globalThis as any).window.core.api.startServer = vi.fn()
      .mockRejectedValueOnce(new Error('Only one usage of each socket address is normally permitted. (os error 10048)'))
      .mockResolvedValueOnce(39292)
    const input = makeInput({ serviceHub: makeServiceHub(false) as any })

    const result = await bootstrapLocalApi(input)

    expect(result).toEqual({ ok: true })
    expect((globalThis as any).window.core.api.startServer).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ port: 39291 })
    )
    expect((globalThis as any).window.core.api.startServer).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ port: 39292 })
    )
    expect(input.setServerPort).toHaveBeenCalledWith(39292)
    expect(input.setServerStatus).toHaveBeenLastCalledWith('running')
  })

  it('does not retry non-bind startup errors', async () => {
    ;(globalThis as any).window.core.api.startServer = vi.fn()
      .mockRejectedValue(new Error('An API key is required'))
    const input = makeInput({ serviceHub: makeServiceHub(false) as any })

    const result = await bootstrapLocalApi(input)

    expect(result.ok).toBe(false)
    expect((globalThis as any).window.core.api.startServer).toHaveBeenCalledTimes(1)
    expect(input.setServerStatus).toHaveBeenLastCalledWith('stopped')
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

  it('reuses the in-flight start call instead of invoking startServer twice', async () => {
    let resolveStart: ((port: number) => void) | undefined
    ;(globalThis as any).window.core.api.startServer = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveStart = resolve
        })
    )

    const firstInput = makeInput({ serviceHub: makeServiceHub(false) as any })
    const secondInput = makeInput({ serviceHub: makeServiceHub(false) as any })

    const firstPromise = bootstrapLocalApi(firstInput)
    await Promise.resolve()
    const secondPromise = bootstrapLocalApi(secondInput)
    await Promise.resolve()

    expect((globalThis as any).window.core.api.startServer).toHaveBeenCalledTimes(1)

    resolveStart?.(39291)

    await expect(firstPromise).resolves.toEqual({ ok: true })
    await expect(secondPromise).resolves.toEqual({ ok: true })
    expect(secondInput.setServerStatus).toHaveBeenCalledWith('pending')
    expect(secondInput.setServerStatus).toHaveBeenLastCalledWith('running')
  })
})
