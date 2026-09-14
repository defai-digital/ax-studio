import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
vi.mock('electron', () => ({ app: { getPath: vi.fn(), isPackaged: true }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('electron-updater', async () => {
  const { EventEmitter } = await import('node:events')
  const updater = new EventEmitter()
  updater.checkForUpdates = vi.fn(async () => { updater.emit('update-available', { version: '2.2.3' }) })
  updater.downloadUpdate = vi.fn(async () => { updater.emit('update-downloaded', { version: '2.2.3' }) })
  return { autoUpdater: updater }
})
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { createStoreHandlers } from '../../electron/src/commands/store.ts'
const roots = []
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
it('loads an absent first-run store and creates its parent on save', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ax-first-store-'))
  roots.push(root)
  app.getPath.mockReturnValue(root)
  const handlers = createStoreHandlers()
  expect(handlers.plugin_store_load({ name: 'mcp.json' })).toEqual({})
  handlers.plugin_store_save({ name: 'mcp.json', data: { servers: [] } })
  expect(handlers.plugin_store_load({ name: 'mcp.json' })).toEqual({ servers: [] })
})
it('uses electron-updater for packaged checks and downloads', async () => {
  vi.useFakeTimers()
  const { initUpdater, createUpdaterHandlers } = await import('../../electron/src/updater.ts')
  await initUpdater()
  const handlers = createUpdaterHandlers()
  expect(await handlers.updater_check()).toMatchObject({ enabled: true, state: 'available', version: '2.2.3' })
  expect(await handlers.updater_download()).toMatchObject({ state: 'downloaded' })
  expect(autoUpdater.checkForUpdates).toHaveBeenCalledOnce()
  expect(autoUpdater.downloadUpdate).toHaveBeenCalledOnce()
})
