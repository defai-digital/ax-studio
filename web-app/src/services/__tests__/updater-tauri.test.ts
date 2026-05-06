import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  invoke: vi.fn(),
  load: vi.fn(),
  store: {
    get: vi.fn(),
    set: vi.fn(),
    save: vi.fn(),
  },
  randomUUID: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: mocks.check,
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}))

vi.mock('@tauri-apps/plugin-store', () => ({
  load: mocks.load,
}))

async function createService() {
  const { TauriUpdaterService } = await import('../updater/tauri')
  return new TauriUpdaterService()
}

describe('TauriUpdaterService', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.load.mockResolvedValue(mocks.store)
    mocks.store.get.mockResolvedValue('stored-nonce')
    mocks.store.set.mockResolvedValue(undefined)
    mocks.store.save.mockResolvedValue(undefined)
    mocks.invoke.mockResolvedValue(null)
    mocks.check.mockResolvedValue(null)
    mocks.randomUUID.mockReturnValue('generated-nonce')
    vi.spyOn(crypto, 'randomUUID').mockImplementation(mocks.randomUUID)
  })

  it('returns standard Tauri update information when no custom update is available', async () => {
    const service = await createService()
    mocks.check.mockResolvedValue({
      version: '1.3.7',
      date: '2026-05-06',
      body: 'Release notes',
      downloadAndInstall: vi.fn(),
    })

    const result = await service.check()

    expect(result).toEqual({
      version: '1.3.7',
      date: '2026-05-06',
      body: 'Release notes',
    })
    expect(mocks.invoke).toHaveBeenCalledWith('check_for_app_updates', {
      nonceSeed: 'stored-nonce',
    })
    expect(mocks.check).toHaveBeenCalledTimes(1)
  })

  it('prefers signed custom metadata when it matches the installable update version', async () => {
    const service = await createService()
    mocks.invoke.mockResolvedValue({
      version: '1.3.7',
      notes: 'Signed release notes',
      pub_date: '2026-05-06T10:00:00Z',
      signature: 'sig-123',
    })
    mocks.check.mockResolvedValue({
      version: '1.3.7',
      date: 'fallback-date',
      body: 'Fallback body',
      downloadAndInstall: vi.fn(),
    })

    const result = await service.check()

    expect(result).toEqual({
      version: '1.3.7',
      date: '2026-05-06T10:00:00Z',
      body: 'Signed release notes',
      signature: 'sig-123',
    })
  })

  it('falls back to standard metadata when custom version does not match installable version', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const service = await createService()
    mocks.invoke.mockResolvedValue({
      version: '1.3.8',
      notes: 'Different custom release',
      pub_date: '2026-05-07',
      signature: 'sig-456',
    })
    mocks.check.mockResolvedValue({
      version: '1.3.7',
      date: '2026-05-06',
      body: 'Installable release',
      downloadAndInstall: vi.fn(),
    })

    const result = await service.check()

    expect(result).toEqual({
      version: '1.3.7',
      date: '2026-05-06',
      body: 'Installable release',
    })
    expect(warnSpy).toHaveBeenCalledWith(
      'Custom updater version did not match installable Tauri updater version:',
      { custom: '1.3.8', installable: '1.3.7' }
    )
    warnSpy.mockRestore()
  })

  it('returns custom update metadata when the Tauri updater has no installable update', async () => {
    const service = await createService()
    mocks.invoke.mockResolvedValue({
      version: '1.3.7',
      notes: 'Custom only',
      pub_date: '2026-05-06',
      signature: 'sig-custom',
    })
    mocks.check.mockResolvedValue(null)

    const result = await service.check()

    expect(result).toEqual({
      version: '1.3.7',
      date: '2026-05-06',
      body: 'Custom only',
      signature: 'sig-custom',
    })
  })

  it('uses a generated nonce seed when the store is empty', async () => {
    const service = await createService()
    mocks.store.get.mockResolvedValue(null)

    await service.check()

    expect(mocks.store.set).toHaveBeenCalledWith('nonce_seed', 'generated-nonce')
    expect(mocks.store.save).toHaveBeenCalled()
    expect(mocks.invoke).toHaveBeenCalledWith('check_for_app_updates', {
      nonceSeed: 'generated-nonce',
    })
  })

  it('uses a temporary nonce seed when the store cannot be read', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const service = await createService()
    mocks.load.mockRejectedValue(new Error('store unavailable'))

    await service.check()

    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to access store for nonce seed, using temporary seed:',
      expect.any(Error)
    )
    expect(mocks.invoke).toHaveBeenCalledWith('check_for_app_updates', {
      nonceSeed: 'generated-nonce',
    })
    warnSpy.mockRestore()
  })

  it('reuses the checked update when installing after a successful check', async () => {
    const service = await createService()
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined)
    mocks.check.mockResolvedValue({
      version: '1.3.7',
      date: '2026-05-06',
      body: 'Installable release',
      downloadAndInstall,
    })

    await service.check()
    await service.installAndRestart()

    expect(mocks.check).toHaveBeenCalledTimes(1)
    expect(downloadAndInstall).toHaveBeenCalledWith()
  })

  it('throws when install is requested but no update is available', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const service = await createService()
    mocks.check.mockResolvedValue(null)

    await expect(service.installAndRestart()).rejects.toThrow('No update available')

    errorSpy.mockRestore()
  })

  it('forwards progress events and isolates progress callback errors', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const service = await createService()
    const downloadAndInstall = vi.fn(async (callback: (event: unknown) => void) => {
      callback({ event: 'Progress', data: { chunkLength: 1024 } })
    })
    mocks.check.mockResolvedValue({
      version: '1.3.7',
      downloadAndInstall,
    })
    const progressCallback = vi.fn(() => {
      throw new Error('consumer failed')
    })

    await service.downloadAndInstallWithProgress(progressCallback)

    expect(progressCallback).toHaveBeenCalledWith({
      event: 'Progress',
      data: { chunkLength: 1024 },
    })
    expect(warnSpy).toHaveBeenCalledWith(
      'Error in download progress callback:',
      expect.any(Error)
    )
    warnSpy.mockRestore()
  })
})

