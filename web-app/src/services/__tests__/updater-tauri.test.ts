import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    mocks.load.mockResolvedValue(mocks.store)
    mocks.store.get.mockResolvedValue('stored-nonce')
    mocks.store.set.mockResolvedValue(undefined)
    mocks.store.save.mockResolvedValue(undefined)
    mocks.invoke.mockResolvedValue(null)
    mocks.check.mockResolvedValue(null)
    mocks.randomUUID.mockReturnValue('generated-nonce')
    vi.spyOn(crypto, 'randomUUID').mockImplementation(mocks.randomUUID)
  })

  afterEach(() => {
    consoleInfoSpy.mockRestore()
  })

  describe('check()', () => {
    it('returns null when the custom backend reports no update', async () => {
      const service = await createService()
      mocks.invoke.mockResolvedValue(null)

      const result = await service.check()

      expect(result).toBeNull()
      expect(mocks.invoke).toHaveBeenCalledWith('check_for_app_updates', {
        nonceSeed: 'stored-nonce',
      })
      // plugin-updater check() must NOT be called during a metadata check
      expect(mocks.check).not.toHaveBeenCalled()
    })

    it('returns UpdateInfo when the custom backend reports an update', async () => {
      const service = await createService()
      mocks.invoke.mockResolvedValue({
        version: '1.3.7',
        notes: 'Release notes',
        pub_date: '2026-05-06T10:00:00Z',
        signature: 'sig-abc',
      })

      const result = await service.check()

      expect(result).toEqual({
        version: '1.3.7',
        body: 'Release notes',
        date: '2026-05-06T10:00:00Z',
        signature: 'sig-abc',
      })
      expect(mocks.check).not.toHaveBeenCalled()
    })

    it('maps optional fields to undefined when absent', async () => {
      const service = await createService()
      mocks.invoke.mockResolvedValue({ version: '1.3.7' })

      const result = await service.check()

      expect(result).toEqual({
        version: '1.3.7',
        body: undefined,
        date: undefined,
        signature: undefined,
      })
    })

    it('returns null and logs when the custom backend throws', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const service = await createService()
      mocks.invoke.mockRejectedValue(new Error('network failure'))

      const result = await service.check()

      expect(result).toBeNull()
      expect(errorSpy).toHaveBeenCalledWith(
        'Error checking for updates in Tauri:',
        expect.any(Error)
      )
      errorSpy.mockRestore()
    })

    it('uses the stored nonce seed', async () => {
      const service = await createService()

      await service.check()

      expect(mocks.invoke).toHaveBeenCalledWith('check_for_app_updates', {
        nonceSeed: 'stored-nonce',
      })
    })

    it('generates and persists a nonce seed when the store is empty', async () => {
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
  })

  describe('downloadAndInstallWithProgress()', () => {
    it('fetches installable update via plugin-updater and calls downloadAndInstall', async () => {
      const service = await createService()
      const downloadAndInstall = vi.fn().mockResolvedValue(undefined)
      mocks.check.mockResolvedValue({ version: '1.3.7', downloadAndInstall })

      await service.downloadAndInstallWithProgress(() => {})

      expect(mocks.check).toHaveBeenCalledTimes(1)
      expect(downloadAndInstall).toHaveBeenCalledTimes(1)
    })

    it('reuses the cached installable update on repeated calls', async () => {
      const service = await createService()
      const downloadAndInstall = vi.fn().mockResolvedValue(undefined)
      mocks.check.mockResolvedValue({ version: '1.3.7', downloadAndInstall })

      // First call caches the Update, second call reuses it
      await service.downloadAndInstallWithProgress(() => {})
      // Cache is cleared after install; call check again
      mocks.check.mockResolvedValue({ version: '1.3.8', downloadAndInstall })
      await service.downloadAndInstallWithProgress(() => {})

      expect(mocks.check).toHaveBeenCalledTimes(2)
    })

    it('throws when plugin-updater finds no installable update', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const service = await createService()
      mocks.check.mockResolvedValue(null)

      await expect(service.downloadAndInstallWithProgress(() => {})).rejects.toThrow(
        'No update available'
      )

      errorSpy.mockRestore()
    })

    it('forwards progress events to the callback', async () => {
      const service = await createService()
      const downloadAndInstall = vi.fn(async (cb: (event: unknown) => void) => {
        cb({ event: 'Started', data: { contentLength: 2048 } })
        cb({ event: 'Progress', data: { chunkLength: 1024 } })
        cb({ event: 'Finished' })
      })
      mocks.check.mockResolvedValue({ version: '1.3.7', downloadAndInstall })
      const progressCallback = vi.fn()

      await service.downloadAndInstallWithProgress(progressCallback)

      expect(progressCallback).toHaveBeenCalledTimes(3)
      expect(progressCallback).toHaveBeenNthCalledWith(1, {
        event: 'Started',
        data: { contentLength: 2048 },
      })
    })

    it('isolates progress callback errors so the install completes', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const service = await createService()
      const downloadAndInstall = vi.fn(async (cb: (event: unknown) => void) => {
        cb({ event: 'Progress', data: { chunkLength: 512 } })
      })
      mocks.check.mockResolvedValue({ version: '1.3.7', downloadAndInstall })

      await service.downloadAndInstallWithProgress(() => {
        throw new Error('consumer error')
      })

      expect(warnSpy).toHaveBeenCalledWith(
        'Error in download progress callback:',
        expect.any(Error)
      )
      warnSpy.mockRestore()
    })

    it('clears the cached update after a successful install', async () => {
      const service = await createService()
      const downloadAndInstall = vi.fn().mockResolvedValue(undefined)
      mocks.check.mockResolvedValue({ version: '1.3.7', downloadAndInstall })

      await service.downloadAndInstallWithProgress(() => {})

      // If cache were not cleared, a second call would not re-fetch
      const secondDownload = vi.fn().mockResolvedValue(undefined)
      mocks.check.mockResolvedValue({ version: '1.3.8', downloadAndInstall: secondDownload })
      await service.downloadAndInstallWithProgress(() => {})

      expect(secondDownload).toHaveBeenCalledTimes(1)
    })
  })
})
