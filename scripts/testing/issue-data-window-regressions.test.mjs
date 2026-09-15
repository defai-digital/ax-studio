import { afterEach, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'

vi.mock('electron', () => ({
  app: { getPath: () => '/unused', getVersion: () => '2.2.2' },
  BrowserWindow: { getAllWindows: vi.fn(), getFocusedWindow: vi.fn() },
  nativeTheme: {}, ipcMain: { handle: vi.fn(), on: vi.fn() },
}))
import { BrowserWindow, ipcMain } from 'electron'
import { commitDownloadFile } from '../../electron/src/downloads/core.ts'
import { createWindowHandlers } from '../../electron/src/commands/window.ts'
import { registerIpcHandlers } from '../../electron/src/commands/registry.ts'
import { bufferOpenFiles, isOpenFileReceiverReady, resetOpenFileReceiver, takePendingOpenFiles } from '../../electron/src/state.ts'
const roots = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await fsp.rm(root, { recursive: true, force: true })
})
async function files() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ax-download-regression-'))
  roots.push(root)
  const dest = path.join(root, 'model.gguf'), temp = dest + '.tmp'
  await fsp.writeFile(dest, 'existing-good-model')
  await fsp.writeFile(temp, 'replacement')
  return { dest, temp }
}
describe('download replacement preserves valid data', () => {
  it.each(['EACCES', 'EPERM', 'ENOENT'])('preserves the destination and source after %s', async (code) => {
    const { dest, temp } = await files()
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.spyOn(fsp, 'rename').mockRejectedValue(Object.assign(new Error('source unavailable'), { code }))
    await expect(commitDownloadFile(temp, dest)).rejects.toThrow()
    expect(await fsp.readFile(dest, 'utf8')).toBe('existing-good-model')
    expect(await fsp.readFile(temp, 'utf8')).toBe('replacement')
  })
  it('replaces an existing destination using the real filesystem', async () => {
    const { dest, temp } = await files()
    await commitDownloadFile(temp, dest)
    expect(await fsp.readFile(dest, 'utf8')).toBe('replacement')
    await expect(fsp.stat(temp)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
function window(id) {
  const win = new EventEmitter()
  Object.assign(win, { id, isDestroyed: () => false, close: vi.fn(), setTitle: vi.fn(), webContents: { id, mainFrame: {} } })
  return win
}
describe('window ownership', () => {
  it('targets main independently of focused child, title and enumeration order', () => {
    let main = window(1)
    const child = window(2)
    BrowserWindow.getAllWindows.mockReturnValue([child, main])
    BrowserWindow.getFocusedWindow.mockReturnValue(child)
    const handlers = createWindowHandlers(() => child, () => main)
    handlers.window_create({ label: 'preview' })
    handlers.window_close({ label: 'main' })
    expect(main.close).toHaveBeenCalledOnce()
    expect(child.close).not.toHaveBeenCalled()
    handlers.window_set_title({ label: 'preview', title: 'Renamed' })
    handlers.window_close({ label: 'preview' })
    expect(child.close).toHaveBeenCalledOnce()
    main = window(3)
    BrowserWindow.getFocusedWindow.mockReturnValue(null)
    handlers.window_close({ label: 'main' })
    expect(main.close).toHaveBeenCalledOnce()
    expect(() => handlers.window_create({ label: 'main' })).toThrow()
  })
  it('rejects child and subframe drains without marking the main renderer ready', async () => {
    const main = window(1), child = window(2)
    takePendingOpenFiles()
    resetOpenFileReceiver()
    bufferOpenFiles(['/fixture/report.pdf'])
    registerIpcHandlers({ getMainWindow: () => main, createChildWindow: () => child })
    const invoke = ipcMain.handle.mock.calls.find(([name]) => name === 'ax:invoke')[1]
    await expect(invoke({ sender: child.webContents, senderFrame: child.webContents.mainFrame }, 'take_pending_open_files')).rejects.toThrow('Only the main renderer')
    await expect(invoke({ sender: main.webContents, senderFrame: {} }, 'take_pending_open_files')).rejects.toThrow()
    expect(isOpenFileReceiverReady()).toBe(false)
    await expect(invoke({ sender: main.webContents, senderFrame: main.webContents.mainFrame }, 'take_pending_open_files')).resolves.toEqual(['/fixture/report.pdf'])
    expect(isOpenFileReceiverReady()).toBe(true)
  })
})
