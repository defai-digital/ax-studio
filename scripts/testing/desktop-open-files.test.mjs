import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  const fakeApp = new EventEmitter()
  fakeApp.isPackaged = false
  fakeApp.requestSingleInstanceLock = vi.fn(() => true)
  fakeApp.quit = vi.fn()
  fakeApp.exit = vi.fn()
  class FakeWindow extends EventEmitter {
    static windows = []
    static getAllWindows() {
      return this.windows.filter((win) => !win.destroyed)
    }
    constructor() {
      super()
      FakeWindow.windows.push(this)
      this.webContents = new EventEmitter()
      this.webContents.setWindowOpenHandler = vi.fn()
      this.webContents.send = vi.fn()
      this.isDestroyed = () => Boolean(this.destroyed)
      this.isMinimized = () => Boolean(this.minimized)
      this.restore = vi.fn(() => {
        this.minimized = false
      })
      this.show = vi.fn()
      this.focus = vi.fn()
      this.loadFile = vi.fn()
      this.loadURL = vi.fn()
    }
    close() {
      this.destroyed = true
      this.emit('closed')
    }
  }
  return { app: fakeApp, BrowserWindow: FakeWindow, shell: {} }
})
vi.mock('../../electron/src/embed.ts', async () => {
  const { app } = await vi.importMock('electron')
  return {
    registerAxStudioBridge: vi.fn(async () => {
      await app.whenReady()
      return {
        getPreloadPath: () => '/preload',
        getRendererPath: () => '/renderer',
      }
    }),
  }
})
vi.mock('../../electron/src/commands/registry.ts', () => ({
  emitToAllWindows: vi.fn(),
}))
vi.mock('../../electron/src/llamacpp/session.ts', () => ({
  cleanupLlamaProcesses: vi.fn(),
  hasActiveSessions: () => false,
}))
vi.mock('../../electron/src/ax-engine/server.ts', () => ({
  hasAxEngineServerRecord: () => false,
  stopAxEngineOnQuit: vi.fn(),
}))
vi.mock('../../electron/src/ax-engine/dependency.ts', () => ({
  checkAxEngineDependency: vi.fn(),
  resolveAxEngineBinary: vi.fn(),
}))
vi.mock('../../electron/src/updater.ts', () => ({
  isUpdateInstallInProgress: () => false,
  isUpdaterActive: () => false,
}))

import { app, BrowserWindow } from 'electron'
let ready, state
beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  app.requestSingleInstanceLock.mockReturnValue(true)
  app.removeAllListeners()
  BrowserWindow.windows = []
  const promise = new Promise((resolve) => {
    ready = resolve
  })
  app.whenReady = () => promise
  state = await import('../../electron/src/state.ts')
  await import('../../electron/src/main.ts')
})
afterEach(() => vi.restoreAllMocks())
async function start() {
  ready()
  await vi.waitFor(() => expect(BrowserWindow.getAllWindows()).toHaveLength(1))
  return BrowserWindow.getAllWindows()[0]
}
function open(file = '/Users/test/example.pdf') {
  app.emit('open-file', { preventDefault: vi.fn() }, file)
}

describe('desktop OS file delivery through the actual main entry', () => {
  it('quits a secondary process before registering any bridge services', async () => {
    vi.resetModules()
    app.removeAllListeners()
    app.requestSingleInstanceLock.mockReturnValue(false)
    const { registerAxStudioBridge } = await import('../../electron/src/embed.ts')
    registerAxStudioBridge.mockClear()
    await import('../../electron/src/main.ts')
    expect(app.quit).toHaveBeenCalledOnce()
    expect(registerAxStudioBridge).not.toHaveBeenCalled()
    expect(BrowserWindow.getAllWindows()).toHaveLength(0)
  })
  it('buffers cold-start Finder requests until the renderer subscribes', async () => {
    open()
    expect(BrowserWindow.getAllWindows()).toHaveLength(0)
    const win = await start()
    open('/Users/test/second.pdf')
    expect(win.webContents.send).not.toHaveBeenCalled()
    expect(state.takePendingOpenFiles()).toEqual([
      '/Users/test/example.pdf',
      '/Users/test/second.pdf',
    ])
    expect(state.takePendingOpenFiles()).toEqual([])
    open('/Users/test/third.pdf')
    expect(win.webContents.send).toHaveBeenCalledExactlyOnceWith('ax:event', {
      kind: 'event',
      name: 'dock-file-drop',
      payload: ['/Users/test/third.pdf'],
    })
  })
  it('recreates the closed main window and retains Finder files even when a child window is open', async () => {
    const old = await start()
    state.takePendingOpenFiles()
    const child = new BrowserWindow()
    old.close()
    open()
    const replacement = BrowserWindow.getAllWindows().find(
      (win) => win !== child
    )
    expect(replacement).toBeDefined()
    expect(replacement.focus).toHaveBeenCalledOnce()
    expect(state.takePendingOpenFiles()).toEqual(['/Users/test/example.pdf'])
    expect(old.webContents.send).not.toHaveBeenCalled()
    expect(child.webContents.send).not.toHaveBeenCalled()
  })
  it('buffers files while the main renderer reloads', async () => {
    const win = await start()
    state.takePendingOpenFiles()
    win.webContents.emit(
      'did-start-navigation',
      {},
      'file:///index.html',
      false,
      true
    )
    open()
    expect(win.webContents.send).not.toHaveBeenCalled()
    expect(state.takePendingOpenFiles()).toEqual(['/Users/test/example.pdf'])
  })
  it('keeps the receiver ready during same-document and subframe navigation', async () => {
    const win = await start()
    state.takePendingOpenFiles()
    win.webContents.emit(
      'did-start-navigation',
      {},
      'file:///index.html#chat',
      true,
      true
    )
    win.webContents.emit(
      'did-start-navigation',
      {},
      'about:blank',
      false,
      false
    )
    open()
    expect(win.webContents.send).toHaveBeenCalledOnce()
    expect(state.takePendingOpenFiles()).toEqual([])
  })
  it('restores a minimized window and delivers Windows Open With paths exactly once', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const win = await start()
    state.takePendingOpenFiles()
    win.minimized = true
    const filename = 'C:\\Users\\test\\My Document.pdf'
    app.emit('second-instance', {}, ['C:\\AX Studio.exe', filename, '--flag'])
    expect(win.restore).toHaveBeenCalledOnce()
    expect(win.focus).toHaveBeenCalledOnce()
    expect(win.webContents.send).toHaveBeenCalledExactlyOnceWith('ax:event', {
      kind: 'event',
      name: 'dock-file-drop',
      payload: [filename],
    })
    expect(state.takePendingOpenFiles()).toEqual([])
  })
  it('retains Windows second-instance paths received before the initial window', async () => {
    const filename = 'C:\\Users\\test\\My Document.pdf'
    app.emit('second-instance', {}, ['C:\\AX Studio.exe', filename])
    const win = await start()
    expect(state.takePendingOpenFiles()).toEqual([filename])
    expect(win.webContents.send).not.toHaveBeenCalled()
  })
  it.each([
    ['darwin', 0],
    ['win32', 1],
  ])('retains %s last-window quit behavior', async (platform, calls) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
    const win = await start()
    win.close()
    app.emit('window-all-closed')
    expect(app.quit).toHaveBeenCalledTimes(calls)
  })
  it('Dock activation recreates the main window without duplicating it on repeated activation', async () => {
    const old = await start()
    old.close()
    app.emit('activate')
    app.emit('activate')
    expect(BrowserWindow.getAllWindows()).toHaveLength(1)
    expect(BrowserWindow.getAllWindows()[0]).not.toBe(old)
  })
})
