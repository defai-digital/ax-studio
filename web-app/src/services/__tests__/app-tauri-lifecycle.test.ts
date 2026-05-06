import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TauriAppService } from '../app/tauri'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  engineManager: {
    engines: new Map<string, unknown>(),
  },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}))

vi.mock('@ax-studio/core', () => ({
  EngineManager: {
    instance: () => mocks.engineManager,
  },
}))

describe('TauriAppService lifecycle paths', () => {
  let service: TauriAppService

  beforeEach(() => {
    service = new TauriAppService()
    vi.clearAllMocks()
    mocks.engineManager.engines.clear()
    mocks.invoke.mockResolvedValue(undefined)
    window.localStorage.clear()
    window.core.api.getAppConfigurations = vi.fn()
    window.core.api.changeAppDataFolder = vi.fn()
  })

  it('unloads active models before factory reset and clears local storage', async () => {
    const firstEngine = {
      getLoadedModels: vi.fn().mockResolvedValue(['llama-3']),
      unload: vi.fn().mockResolvedValue(undefined),
    }
    const secondEngine = {
      getLoadedModels: vi.fn().mockResolvedValue(['mlx-model']),
      unload: vi.fn().mockResolvedValue(undefined),
    }
    mocks.engineManager.engines.set('llamacpp', firstEngine)
    mocks.engineManager.engines.set('mlx', secondEngine)
    window.localStorage.setItem('theme', 'dark')

    await service.factoryReset()

    expect(firstEngine.unload).toHaveBeenCalledWith('llama-3')
    expect(secondEngine.unload).toHaveBeenCalledWith('mlx-model')
    expect(mocks.invoke).toHaveBeenCalledWith('factory_reset')
    expect(window.localStorage.getItem('theme')).toBeNull()
  })

  it('continues factory reset when one model fails to unload', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const engine = {
      getLoadedModels: vi.fn().mockResolvedValue(['bad-model', 'good-model']),
      unload: vi
        .fn()
        .mockRejectedValueOnce(new Error('unload failed'))
        .mockResolvedValueOnce(undefined),
    }
    mocks.engineManager.engines.set('llamacpp', engine)

    await service.factoryReset()

    expect(engine.unload).toHaveBeenCalledTimes(2)
    expect(mocks.invoke).toHaveBeenCalledWith('factory_reset')
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to unload model during reset',
      expect.any(Error)
    )
    errorSpy.mockRestore()
  })

  it('rejects concurrent factory reset calls while reset is in progress', async () => {
    let finishReset: (() => void) | undefined
    mocks.invoke.mockImplementation(
      () => new Promise<void>((resolve) => {
        finishReset = resolve
      })
    )

    const firstReset = service.factoryReset()
    await vi.waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('factory_reset')
    )
    await expect(service.factoryReset()).rejects.toThrow(
      'Factory reset already in progress'
    )
    finishReset?.()
    await firstReset
  })

  it('resets the in-progress flag after a failed factory reset invoke', async () => {
    mocks.invoke
      .mockRejectedValueOnce(new Error('reset failed'))
      .mockResolvedValueOnce(undefined)

    await expect(service.factoryReset()).rejects.toThrow('reset failed')
    await expect(service.factoryReset()).resolves.toBeUndefined()
  })

  it('returns undefined when reading the app data folder fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(window.core.api.getAppConfigurations).mockRejectedValue(
      new Error('config failed')
    )

    await expect(service.getAppDataFolder()).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to get Ax-Studio data folder:',
      expect.any(Error)
    )
    errorSpy.mockRestore()
  })

  it('throws when relocating without a core API bridge', async () => {
    const originalApi = window.core.api
    window.core.api = undefined as never

    await expect(service.relocateAppDataFolder('/new/path')).rejects.toThrow(
      'Core API not available'
    )

    window.core.api = originalApi
  })

  it('proxies server status and YAML reads through invoke', async () => {
    mocks.invoke.mockResolvedValueOnce(true).mockResolvedValueOnce({ port: 4000 })

    await expect(service.getServerStatus()).resolves.toBe(true)
    expect(mocks.invoke).toHaveBeenCalledWith('get_server_status')

    await expect(service.readYaml('/tmp/config.yaml')).resolves.toEqual({
      port: 4000,
    })
    expect(mocks.invoke).toHaveBeenCalledWith('read_yaml', {
      path: '/tmp/config.yaml',
    })
  })
})
