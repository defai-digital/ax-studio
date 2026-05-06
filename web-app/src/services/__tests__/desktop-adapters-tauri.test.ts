import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TauriDeepLinkService } from '../deeplink/tauri'
import { TauriDialogService } from '../dialog/tauri'
import { TauriEventsService } from '../events/tauri'
import { TauriOpenerService } from '../opener/tauri'
import { TauriThemeService } from '../theme/tauri'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  onOpenUrl: vi.fn(),
  getCurrent: vi.fn(),
  emit: vi.fn(),
  listen: vi.fn(),
  revealItemInDir: vi.fn(),
  getAllWebviewWindows: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}))

vi.mock('@tauri-apps/plugin-deep-link', () => ({
  onOpenUrl: mocks.onOpenUrl,
  getCurrent: mocks.getCurrent,
}))

vi.mock('@tauri-apps/api/event', () => ({
  emit: mocks.emit,
  listen: mocks.listen,
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  revealItemInDir: mocks.revealItemInDir,
}))

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getAllWebviewWindows: mocks.getAllWebviewWindows,
}))

describe('small Tauri desktop service adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('TauriDeepLinkService', () => {
    it('registers deep link handlers and returns the Tauri unlisten function', async () => {
      const service = new TauriDeepLinkService()
      const handler = vi.fn()
      const unlisten = vi.fn()
      mocks.onOpenUrl.mockResolvedValue(unlisten)

      await expect(service.onOpenUrl(handler)).resolves.toBe(unlisten)

      expect(mocks.onOpenUrl).toHaveBeenCalledWith(handler)
    })

    it('returns a no-op unlisten function when deep link registration fails', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const service = new TauriDeepLinkService()
      mocks.onOpenUrl.mockRejectedValue(new Error('plugin unavailable'))

      const unlisten = await service.onOpenUrl(vi.fn())

      expect(() => unlisten()).not.toThrow()
      expect(errorSpy).toHaveBeenCalledWith(
        'Error setting up deep link handler in Tauri:',
        expect.any(Error)
      )
      errorSpy.mockRestore()
    })

    it('normalizes current deep links to an array', async () => {
      const service = new TauriDeepLinkService()
      mocks.getCurrent.mockResolvedValueOnce(['ax://open'])
      await expect(service.getCurrent()).resolves.toEqual(['ax://open'])

      mocks.getCurrent.mockResolvedValueOnce(null)
      await expect(service.getCurrent()).resolves.toEqual([])
    })
  })

  describe('TauriDialogService', () => {
    it('opens and saves native dialogs with options', async () => {
      const service = new TauriDialogService()
      const options = { directory: true, multiple: false }
      mocks.invoke.mockResolvedValueOnce('/tmp/input').mockResolvedValueOnce('/tmp/output')

      await expect(service.open(options)).resolves.toBe('/tmp/input')
      expect(mocks.invoke).toHaveBeenCalledWith('open_dialog', { options })

      await expect(service.save(options)).resolves.toBe('/tmp/output')
      expect(mocks.invoke).toHaveBeenCalledWith('save_dialog', { options })
    })

    it('wraps non-Error dialog failures with useful defaults', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const service = new TauriDialogService()
      mocks.invoke.mockRejectedValueOnce('denied')

      await expect(service.open()).rejects.toThrow('Failed to open native dialog')

      mocks.invoke.mockRejectedValueOnce('denied')
      await expect(service.save()).rejects.toThrow('Failed to open save dialog')

      errorSpy.mockRestore()
    })
  })

  describe('TauriEventsService', () => {
    it('emits and listens through the Tauri event API', async () => {
      const service = new TauriEventsService()
      const handler = vi.fn()
      const unlisten = vi.fn()
      mocks.listen.mockResolvedValue(unlisten)

      await service.emit('theme-changed', 'dark')
      expect(mocks.emit).toHaveBeenCalledWith('theme-changed', 'dark')

      await expect(service.listen('theme-changed', handler)).resolves.toBe(
        unlisten
      )
      expect(mocks.listen).toHaveBeenCalledWith('theme-changed', handler)
    })

    it('propagates emit failures and falls back to a no-op listener on listen failure', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const service = new TauriEventsService()
      const error = new Error('event bus down')
      mocks.emit.mockRejectedValue(error)

      await expect(service.emit('broken')).rejects.toThrow(error)

      mocks.listen.mockRejectedValue(new Error('listen failed'))
      const unlisten = await service.listen('broken', vi.fn())
      expect(() => unlisten()).not.toThrow()

      errorSpy.mockRestore()
    })
  })

  describe('TauriOpenerService', () => {
    it('reveals an item in its directory and propagates failures', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const service = new TauriOpenerService()
      mocks.revealItemInDir.mockResolvedValueOnce(undefined)

      await service.revealItemInDir('/tmp/model.gguf')
      expect(mocks.revealItemInDir).toHaveBeenCalledWith('/tmp/model.gguf')

      const error = new Error('finder failed')
      mocks.revealItemInDir.mockRejectedValueOnce(error)
      await expect(service.revealItemInDir('/tmp/model.gguf')).rejects.toThrow(
        error
      )

      errorSpy.mockRestore()
    })
  })

  describe('TauriThemeService', () => {
    it('sets the selected theme on every open webview window', async () => {
      const service = new TauriThemeService()
      const first = { label: 'main', setTheme: vi.fn().mockResolvedValue(undefined) }
      const second = { label: 'logs', setTheme: vi.fn().mockResolvedValue(undefined) }
      mocks.getAllWebviewWindows.mockResolvedValue([first, second])

      await service.setTheme('dark')

      expect(first.setTheme).toHaveBeenCalledWith('dark')
      expect(second.setTheme).toHaveBeenCalledWith('dark')
    })

    it('supports object-shaped window collections from Tauri', async () => {
      const service = new TauriThemeService()
      const main = { label: 'main', setTheme: vi.fn().mockResolvedValue(undefined) }
      mocks.getAllWebviewWindows.mockResolvedValue({ main })

      await service.getCurrentWindow().setTheme('light')

      expect(main.setTheme).toHaveBeenCalledWith('light')
    })

    it('continues updating other windows if one window rejects', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const service = new TauriThemeService()
      const broken = {
        label: 'broken',
        setTheme: vi.fn().mockRejectedValue(new Error('closed')),
      }
      const healthy = {
        label: 'healthy',
        setTheme: vi.fn().mockResolvedValue(undefined),
      }
      mocks.getAllWebviewWindows.mockResolvedValue([broken, healthy])

      await service.setTheme(null)

      expect(healthy.setTheme).toHaveBeenCalledWith(null)
      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to set theme for window broken:',
        expect.any(Error)
      )
      errorSpy.mockRestore()
    })

    it('throws when the Tauri window list cannot be read', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const service = new TauriThemeService()
      const error = new Error('window list unavailable')
      mocks.getAllWebviewWindows.mockRejectedValue(error)

      await expect(service.setTheme('dark')).rejects.toThrow(error)

      errorSpy.mockRestore()
    })
  })
})

