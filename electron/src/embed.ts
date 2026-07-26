// Programmatic embedding API (Phase 5).
//
// Lets a HOST Electron app embed AX Studio: one call registers the full
// `ax:invoke` / `ax:event-emit` IPC bridge (the complete command registry),
// the `ax-file://` privileged protocol, and returns paths the host needs to
// wire its own BrowserWindow/WebContentsView (preload + bundled renderer).
// The standalone shell (main.ts) consumes this same function, so embedded and
// standalone behavior can never drift apart.
//
// Usage (host main process):
//   import { registerAxStudioBridge } from '@ax-studio/electron/embed'
//   const bridge = await registerAxStudioBridge()   // call BEFORE app.whenReady()
//   const win = new BrowserWindow({ webPreferences: { preload: bridge.getPreloadPath(), sandbox: false } })
//   win.loadFile(path.join(bridge.getRendererPath(), 'index.html'))
//
// Call registerAxStudioBridge() early — before app.whenReady() — because the
// `ax-file` scheme privileges must be declared before the app is ready. The
// function awaits readiness internally, so the returned promise resolves once
// the bridge is fully wired. See docs/architecture/electron-embedding.md.
import { app, BrowserWindow, net, protocol } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registerIpcHandlers, type CommandContext } from './commands/registry.js'
import { emitToAllWindows } from './events.js'
import { canonicalizeLoose, isPathAllowed, setDataFolderOverride } from './state.js'
import { initUpdater, setUpdaterDisabledReason } from './updater.js'

export interface AxStudioBridgeOptions {
  /**
   * Pin the AX Studio data folder (threads, models, llamacpp backends,
   * secrets are NOT affected — those live in userData). Wins over the
   * persisted userData/configuration.json; `change_app_data_folder` becomes
   * a no-op for path resolution. Default: resolution order is
   * configuration.json → <appData>/AX Studio/data.
   */
  dataFolder?: string
  /**
   * Override Electron's userData path (configuration.json, secrets.json,
   * stores/, logs/). Must be set before the app is ready — pass it here
   * rather than calling app.setPath yourself so ordering stays correct.
   */
  userDataFolder?: string
  /**
   * Initialize electron-updater. Default FALSE for embedded use: the host
   * owns its own update story. The standalone shell passes true; even then
   * the updater only activates in packaged production builds, never in dev
   * or smoke mode.
   */
  enableUpdater?: boolean
  /** Bridge log sink. Defaults to console.log with an [ax-studio] prefix. */
  log?: (message: string) => void
  /**
   * Window used as the parent for dialogs and as the target of
   * window_* commands. Defaults to the first open BrowserWindow.
   */
  getMainWindow?: () => BrowserWindow | null
  /**
   * Factory for window_create. Defaults to a plain BrowserWindow with the
   * bridge preload that loads the bundled renderer.
   */
  createChildWindow?: CommandContext['createChildWindow']
}

export interface AxStudioBridgeHandle {
  /** Detach the IPC handlers and the ax-file protocol handler. */
  dispose(): void
  /** Absolute path of the built CommonJS preload — use as webPreferences.preload. */
  getPreloadPath(): string
  /** Absolute path of the bundled renderer directory (contains index.html). */
  getRendererPath(): string
  /** Main→renderer broadcast: every window with the bridge preload receives it. */
  events: {
    emit(name: string, payload?: unknown): void
  }
}

// dist/embed.js → package root; keeps preload/renderer resolution correct no
// matter which app (standalone, host, packaged asar) loads this module.
const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(moduleDir, '..')

let activeHandle: AxStudioBridgeHandle | null = null

export function getPreloadPath(): string {
  return path.join(packageRoot, 'dist-preload', 'preload.js')
}

export function getRendererPath(): string {
  const candidates = [
    // Packaged standalone app: renderer staged as web-dist/ inside the asar
    // (electron-builder.yml). Only meaningful for the AX Studio shell itself.
    path.join(app.getAppPath(), 'web-dist'),
    // Packed/published @ax-studio/electron, and repo builds (the build script
    // copies web-app/dist → electron/dist-renderer).
    path.join(packageRoot, 'dist-renderer'),
    // Monorepo fallback for checkouts where the copy step has not run.
    path.resolve(packageRoot, '..', 'web-app', 'dist'),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir
  }
  return candidates[1]
}

function defaultCreateChildWindow(label: string, options: Record<string, unknown>): BrowserWindow {
  const win = new BrowserWindow({
    width: typeof options.width === 'number' ? options.width : 800,
    height: typeof options.height === 'number' ? options.height : 600,
    title: typeof options.title === 'string' ? options.title : label,
    center: options.center !== false,
    resizable: options.resizable !== false,
    minimizable: options.minimizable !== false,
    maximizable: options.maximizable !== false,
    closable: options.closable !== false,
    webPreferences: {
      contextIsolation: true,
      backgroundThrottling: false,
      // The preload only uses contextBridge + ipcRenderer, but it is a
      // separately-compiled CommonJS file, which requires sandbox: false.
      sandbox: false,
      preload: getPreloadPath(),
    },
  })
  const route = typeof options.url === 'string' ? options.url : undefined
  void win.loadFile(path.join(getRendererPath(), 'index.html'), route ? { hash: route } : undefined)
  return win
}

// Must run before app is ready: lets the renderer fetch()/stream ax-file://
// URLs (the convertFileSrc replacement).
function registerAxFileSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'ax-file',
      privileges: {
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ])
}

// Serves ax-file:// URLs, confined to the app data folder + session-approved
// paths (dialog picks, OS open-file). Path traversal protection mirrors the
// Rust resolve_path helper.
function registerAxFileProtocol(): void {
  protocol.handle('ax-file', (request) => {
    try {
      const url = new URL(request.url)
      const filePath = canonicalizeLoose(decodeURIComponent(url.pathname))
      if (!isPathAllowed(filePath)) {
        return new Response('Forbidden: path outside app data folder', { status: 403 })
      }
      return net.fetch(pathToFileURL(filePath).toString())
    } catch (error) {
      return new Response(`Bad ax-file URL: ${(error as Error).message}`, { status: 400 })
    }
  })
}

/**
 * Register the AX Studio bridge in the current (host) app. Idempotent: a
 * second call returns the existing handle — `ax:invoke` is an app-global
 * channel and can only have one handler.
 *
 * The synchronous pre-ready work (userData override, scheme privileges) runs
 * immediately when this is called; the IPC/protocol wiring runs once the app
 * is ready. Call it at the top of the host's main entry, then await it.
 */
export async function registerAxStudioBridge(
  options: AxStudioBridgeOptions = {}
): Promise<AxStudioBridgeHandle> {
  const log = options.log ?? ((message: string) => console.log(`[ax-studio] ${message}`))
  if (activeHandle) {
    log('registerAxStudioBridge() called twice — returning the existing handle')
    return activeHandle
  }

  // ── Synchronous, pre-ready section (no awaits above this line) ──
  if (options.userDataFolder) {
    app.setPath('userData', options.userDataFolder)
  }
  if (options.dataFolder) {
    setDataFolderOverride(options.dataFolder)
  }
  if (options.enableUpdater !== true) {
    setUpdaterDisabledReason('embedded')
  }
  if (app.isReady()) {
    throw new Error(
      'registerAxStudioBridge() must be called before app.whenReady() ' +
        '(the ax-file scheme privileges cannot be registered afterwards)'
    )
  }
  registerAxFileSchemePrivileges()

  // ── Post-ready wiring ──
  await app.whenReady()

  registerAxFileProtocol()
  const context: CommandContext = {
    getMainWindow: options.getMainWindow ?? (() => BrowserWindow.getAllWindows()[0] ?? null),
    createChildWindow: options.createChildWindow ?? defaultCreateChildWindow,
  }
  const disposeIpc = registerIpcHandlers(context)

  if (options.enableUpdater === true) {
    // initUpdater() self-gates to packaged production builds (never dev/smoke).
    try {
      await initUpdater()
    } catch (error) {
      log(`updater init failed: ${(error as Error).message ?? String(error)}`)
    }
  }

  let disposed = false
  const handle: AxStudioBridgeHandle = {
    dispose: () => {
      if (disposed) return
      disposed = true
      disposeIpc()
      try {
        protocol.unhandle('ax-file')
      } catch {
        // best effort — Electron throws if no handler is registered
      }
      activeHandle = null
    },
    getPreloadPath,
    getRendererPath,
    events: {
      emit: (name, payload) => emitToAllWindows(name, payload),
    },
  }
  activeHandle = handle
  log('bridge registered (ax:invoke, ax:event, ax-file://)')
  return handle
}
