import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TauriCoreService } from '../core/tauri'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  convertFileSrc: mocks.convertFileSrc,
}))

describe('TauriCoreService', () => {
  let service: TauriCoreService

  beforeEach(() => {
    service = new TauriCoreService()
    vi.clearAllMocks()
    mocks.convertFileSrc.mockImplementation((path, protocol) =>
      protocol ? `${protocol}://${path}` : `asset://${path}`
    )
  })

  it('invokes a Tauri command with args and returns the typed result', async () => {
    mocks.invoke.mockResolvedValue({ ok: true })

    await expect(service.invoke<{ ok: boolean }>('ping', { id: 1 })).resolves.toEqual({
      ok: true,
    })

    expect(mocks.invoke).toHaveBeenCalledWith('ping', { id: 1 })
  })

  it('rethrows invoke failures after logging command context', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = new Error('ipc failed')
    mocks.invoke.mockRejectedValue(error)

    await expect(service.invoke('broken')).rejects.toThrow(error)

    expect(errorSpy).toHaveBeenCalledWith(
      "Error invoking Tauri command 'broken' in Tauri:",
      error
    )
    errorSpy.mockRestore()
  })

  it('converts file paths through the Tauri asset protocol', () => {
    expect(service.convertFileSrc('/tmp/model.gguf', 'asset')).toBe(
      'asset:///tmp/model.gguf'
    )
    expect(mocks.convertFileSrc).toHaveBeenCalledWith('/tmp/model.gguf', 'asset')
  })

  it('returns the original path when file source conversion fails', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.convertFileSrc.mockImplementation(() => {
      throw new Error('bad path')
    })

    expect(service.convertFileSrc('/tmp/file.txt')).toBe('/tmp/file.txt')
    expect(errorSpy).toHaveBeenCalledWith(
      'Error converting file src in Tauri:',
      expect.any(Error)
    )
    errorSpy.mockRestore()
  })

  it('reads active extensions and returns an empty list on failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const extensions = [{ id: 'assistant', name: 'Assistant' }]
    mocks.invoke.mockResolvedValueOnce(extensions)

    await expect(service.getActiveExtensions()).resolves.toEqual(extensions)
    expect(mocks.invoke).toHaveBeenCalledWith('get_active_extensions', undefined)

    mocks.invoke.mockRejectedValueOnce(new Error('missing folder'))
    await expect(service.getActiveExtensions()).resolves.toEqual([])

    errorSpy.mockRestore()
  })

  it('installs all bundled extensions and propagates install failures', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.invoke.mockResolvedValueOnce(undefined)

    await service.installExtensions()
    expect(mocks.invoke).toHaveBeenCalledWith('install_extensions', undefined)

    const error = new Error('install failed')
    mocks.invoke.mockRejectedValueOnce(error)
    await expect(service.installExtensions()).rejects.toThrow(error)

    errorSpy.mockRestore()
  })

  it('installs selected extensions and falls back to an empty list on failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const extensions = [{ id: 'download', name: 'Download' }]
    mocks.invoke.mockResolvedValueOnce(extensions)

    await expect(service.installExtension(extensions as never)).resolves.toEqual(
      extensions
    )
    expect(mocks.invoke).toHaveBeenCalledWith('install_extension', {
      extensions,
    })

    mocks.invoke.mockRejectedValueOnce(new Error('bad extension'))
    await expect(service.installExtension(extensions as never)).resolves.toEqual([])

    errorSpy.mockRestore()
  })

  it('uninstalls extensions with reload enabled by default and returns false on failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.invoke.mockResolvedValueOnce(true)

    await expect(service.uninstallExtension(['assistant'])).resolves.toBe(true)
    expect(mocks.invoke).toHaveBeenCalledWith('uninstall_extension', {
      extensions: ['assistant'],
      reload: true,
    })

    mocks.invoke.mockResolvedValueOnce(false)
    await expect(service.uninstallExtension(['assistant'], false)).resolves.toBe(
      false
    )
    expect(mocks.invoke).toHaveBeenLastCalledWith('uninstall_extension', {
      extensions: ['assistant'],
      reload: false,
    })

    mocks.invoke.mockRejectedValueOnce(new Error('remove failed'))
    await expect(service.uninstallExtension(['assistant'])).resolves.toBe(false)

    errorSpy.mockRestore()
  })
})

