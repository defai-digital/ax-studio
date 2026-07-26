import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TauriDialogService } from '../dialog/tauri'
import { TauriEventsService } from '../events/tauri'
import { TauriOpenerService } from '../opener/tauri'
import { TauriThemeService } from '../theme/tauri'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  emit: vi.fn(),
  listen: vi.fn(),
  revealItemInDir: vi.fn(),
  getAllWebviewWindows: vi.fn(),
}))

vi.mock('@/lib/tauri-shim/api-core', () => ({
  invoke: mocks.invoke,
}))

vi.mock('@/lib/tauri-shim/api-event', () => ({
  emit: mocks.emit,
  listen: mocks.listen,
}))

vi.mock('@/lib/tauri-shim/plugin-opener', () => ({
  revealItemInDir: mocks.revealItemInDir,
}))

vi.mock('@/lib/tauri-shim/api-webview-window', () => ({
  getAllWebviewWindows: mocks.getAllWebviewWindows,
}))

describe('small Tauri desktop service adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

    it('falls back safely when emit or listen fail', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const service = new TauriEventsService()
      const error = new Error('event bus down')
      mocks.emit.mockRejectedValue(error)

      await expect(service.emit('broken')).resolves.toBeUndefined()

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
