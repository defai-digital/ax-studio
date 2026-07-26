// Minimal host app embedding AX Studio via the programmatic bridge (Phase 5).
// The whole integration is three steps:
//   1. registerAxStudioBridge() early in the main process (before ready)
//   2. BrowserWindow with webPreferences.preload = bridge.getPreloadPath()
//   3. win.loadFile(path.join(bridge.getRendererPath(), 'index.html'))
//
// Run:   yarn start          (from this directory)
// Smoke: yarn smoke          (headless assertions, exits 0/1)
import { app, BrowserWindow } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerAxStudioBridge } from '@ax-studio/electron/embed'

const SMOKE = process.argv.includes('--smoke')

// Called at module top level — BEFORE app.whenReady() — because the ax-file
// scheme privileges cannot be registered after the app is ready. The promise
// resolves once the bridge is fully wired. Smoke mode pins throwaway
// userData + data folders so the developer's real data is never touched.
const bridgePromise = registerAxStudioBridge({
  userDataFolder: SMOKE
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'ax-host-smoke-userdata-'))
    : undefined,
  dataFolder: SMOKE
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'ax-host-smoke-data-'))
    : undefined,
})

function createWindow(bridge) {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    show: !SMOKE,
    webPreferences: {
      contextIsolation: true,
      // The preload is a separately-compiled CommonJS file → sandbox: false.
      sandbox: false,
      preload: bridge.getPreloadPath(),
      // Lets the renderer skip boot auto-starts that would race smoke checks.
      ...(SMOKE ? { additionalArguments: ['--ax-smoke'] } : {}),
    },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  void win.loadFile(path.join(bridge.getRendererPath(), 'index.html'))
  return win
}

void app.whenReady().then(async () => {
  const bridge = await bridgePromise
  const win = createWindow(bridge)
  if (SMOKE) {
    await runSmoke(bridge, win)
    return
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(bridge)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ─── Embed smoke harness ─────────────────────────────────────────────────────
// Proves the embedded bridge end-to-end: the bundled renderer boots in a plain
// host BrowserWindow, the full command registry round-trips, main→renderer
// events broadcast, and a second window is equally functional.

const WINDOW_CHECK = `(async () => {
  const lines = []
  let ok = true
  const check = (name, cond) => { lines.push((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) ok = false }
  check('window.axElectron exposed', !!window.axElectron && typeof window.axElectron.invoke === 'function')
  const deadline = Date.now() + 20000
  while (!window.__ax || !window.__ax.router) {
    if (Date.now() > deadline) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  check('renderer boots (window.__ax.router)', !!(window.__ax && window.__ax.router))
  try {
    const folder = await window.axElectron.invoke('get_app_data_folder_path')
    check('get_app_data_folder_path returns a path', typeof folder === 'string' && folder.length > 0)
    window.__axEmbedDataFolder = folder
  } catch (error) {
    check('get_app_data_folder_path threw: ' + (error && error.message ? error.message : String(error)), false)
  }
  try {
    const before = await window.axElectron.invoke('list_threads')
    const thread = await window.axElectron.invoke('create_thread', {
      thread: { object: 'thread', title: 'embed-smoke', assistants: [], metadata: {} },
    })
    const after = await window.axElectron.invoke('list_threads')
    check('list_threads round-trip', Array.isArray(before) && after.some((t) => t.id === thread.id))
    await window.axElectron.invoke('delete_thread', { threadId: thread.id })
  } catch (error) {
    check('list_threads round-trip threw: ' + (error && error.message ? error.message : String(error)), false)
  }
  window.__axEmbedEvents = []
  window.axElectron.onEvent((envelope) => {
    if (envelope && envelope.kind === 'event') window.__axEmbedEvents.push(envelope.name)
  })
  return { ok, lines }
})()`

async function runSmoke(bridge, win1) {
  let failures = 0
  const report = (lines) => {
    for (const line of lines) {
      console.log(`[embed-smoke] ${line}`)
      if (line.startsWith('FAIL')) failures += 1
    }
  }
  const finish = (code) => app.exit(failures > 0 ? 1 : code)
  setTimeout(() => {
    console.error('[embed-smoke] TIMEOUT')
    app.exit(1)
  }, 120_000)

  const waitLoaded = (win) =>
    win.webContents.isLoading()
      ? new Promise((resolve) => win.webContents.once('did-finish-load', resolve))
      : Promise.resolve()

  try {
    // Window 1: bridge handshake + command round-trips.
    await waitLoaded(win1)
    const result1 = await win1.webContents.executeJavaScript(WINDOW_CHECK)
    report(result1.lines.map((line) => `win1 ${line}`))
    if (!result1.ok) failures += 1

    // The dataFolder option must pin the data folder.
    const folder = await win1.webContents.executeJavaScript('window.__axEmbedDataFolder')
    const pinned = typeof folder === 'string' && folder.includes('ax-host-smoke-data-')
    report([`${pinned ? 'PASS' : 'FAIL'} dataFolder option pins the data folder (${folder})`])
    if (!pinned) failures += 1

    // Window 2: multi-window safety — same bridge, same registry.
    const win2 = createWindow(bridge)
    await waitLoaded(win2)
    const result2 = await win2.webContents.executeJavaScript(WINDOW_CHECK)
    report(result2.lines.map((line) => `win2 ${line}`))
    if (!result2.ok) failures += 1

    // Main→renderer broadcast reaches BOTH windows.
    bridge.events.emit('embed-smoke-event', { from: 'host-main' })
    for (const [label, win] of [['win1', win1], ['win2', win2]]) {
      let received = false
      const deadline = Date.now() + 5000
      while (Date.now() < deadline && !received) {
        received = await win.webContents.executeJavaScript(
          "window.__axEmbedEvents && window.__axEmbedEvents.includes('embed-smoke-event')"
        )
        if (!received) await new Promise((resolve) => setTimeout(resolve, 100))
      }
      report([`${received ? 'PASS' : 'FAIL'} ${label} receives main→renderer broadcast`])
      if (!received) failures += 1
    }

    finish(failures === 0 ? 0 : 1)
  } catch (error) {
    console.error(`[embed-smoke] harness error: ${error && error.message ? error.message : error}`)
    app.exit(1)
  }
}
