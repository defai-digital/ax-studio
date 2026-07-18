import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  unregister: vi.fn(),
  unregisterAll: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-global-shortcut', () => ({
  register: mocks.register,
  unregister: mocks.unregister,
  unregisterAll: mocks.unregisterAll,
}))

async function createService() {
  const { TauriGlobalShortcutService } = await import('../global-shortcut/tauri')
  return new TauriGlobalShortcutService()
}

describe('TauriGlobalShortcutService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.register.mockResolvedValue(undefined)
    mocks.unregister.mockResolvedValue(undefined)
    mocks.unregisterAll.mockResolvedValue(undefined)
  })

  it('registers a shortcut and tracks it locally', async () => {
    const service = await createService()

    expect(service.getRegistered()).toBeNull()
    await service.register('CmdOrCtrl+Shift+Space')

    expect(mocks.register).toHaveBeenCalledWith('CmdOrCtrl+Shift+Space', expect.any(Function))
    expect(service.getRegistered()).toBe('CmdOrCtrl+Shift+Space')
  })

  it('does not track a registration that fails', async () => {
    const service = await createService()
    mocks.register.mockRejectedValue(new Error('shortcut taken'))

    await expect(service.register('Alt+Space')).rejects.toThrow('shortcut taken')
    expect(service.getRegistered()).toBeNull()
  })

  it('unregisters the tracked shortcut', async () => {
    const service = await createService()
    await service.register('CmdOrCtrl+Shift+Space')

    await service.unregister('CmdOrCtrl+Shift+Space')

    expect(mocks.unregister).toHaveBeenCalledWith('CmdOrCtrl+Shift+Space')
    expect(service.getRegistered()).toBeNull()
  })

  it('remap moves registration from the old combo to the new one', async () => {
    const service = await createService()
    await service.register('CmdOrCtrl+Shift+Space')

    await service.remap('CmdOrCtrl+Shift+K')

    expect(mocks.unregister).toHaveBeenCalledWith('CmdOrCtrl+Shift+Space')
    expect(mocks.register).toHaveBeenCalledWith('CmdOrCtrl+Shift+K', expect.any(Function))
    expect(service.getRegistered()).toBe('CmdOrCtrl+Shift+K')
  })

  it('remap to the same combo is a no-op', async () => {
    const service = await createService()
    await service.register('CmdOrCtrl+Shift+Space')
    mocks.register.mockClear()

    await service.remap('CmdOrCtrl+Shift+Space')

    expect(mocks.unregister).not.toHaveBeenCalled()
    expect(mocks.register).not.toHaveBeenCalled()
    expect(service.getRegistered()).toBe('CmdOrCtrl+Shift+Space')
  })

  it('remap restores the previous shortcut when the new one fails', async () => {
    const service = await createService()
    await service.register('CmdOrCtrl+Shift+Space')

    mocks.register.mockImplementation(async (shortcut: string) => {
      if (shortcut === 'Alt+Space') throw new Error('shortcut taken')
    })

    await expect(service.remap('Alt+Space')).rejects.toThrow('shortcut taken')

    // Old combo unregistered once, then re-registered to restore it.
    expect(mocks.unregister).toHaveBeenCalledWith('CmdOrCtrl+Shift+Space')
    expect(mocks.register).toHaveBeenLastCalledWith('CmdOrCtrl+Shift+Space', expect.any(Function))
    expect(service.getRegistered()).toBe('CmdOrCtrl+Shift+Space')
  })

  it('unregisterAll clears the tracked shortcut', async () => {
    const service = await createService()
    await service.register('CmdOrCtrl+Shift+Space')

    await service.unregisterAll()

    expect(mocks.unregisterAll).toHaveBeenCalled()
    expect(service.getRegistered()).toBeNull()
  })
})
