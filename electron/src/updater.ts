// electron-updater wiring (Phase 4) — replaces tauri-plugin-updater and the
// self-hosted HMAC updater (migration matrix §2.2/§2.3).
//
// Hard gating: the updater is only ever INITIALIZED in a packaged production
// build (`app.isPackaged`) and never in smoke mode. Dev and smoke runs keep
// the IPC surface (`updater_check` / `updater_download` / `updater_install`)
// registered but inert — they return `{ enabled: false, reason }` without
// touching electron-updater, so no network call is possible (asserted by the
// smoke suite).
import { app } from 'electron'
import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater'
import { emitToAllWindows } from './events.js'
import type { CommandHandler } from './commands/registry.js'

export const UPDATER_EVENT = 'updater-event'

export type UpdaterState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdaterStatus {
  /** False in dev/smoke/embedded-default — the renderer hides all updater UI. */
  enabled: boolean
  reason?: 'dev' | 'smoke' | 'embedded'
  state: UpdaterState
  version?: string
  percent?: number
  message?: string
}

const SMOKE_MODE = process.argv.includes('--smoke')
let disabledReason: 'dev' | 'smoke' | 'embedded' = SMOKE_MODE ? 'smoke' : 'dev'

/**
 * Embed API: hosts get the updater OFF by default
 * (`registerAxStudioBridge({ enableUpdater: false })`), so the IPC surface
 * reports why it is inert instead of looking broken.
 */
export function setUpdaterDisabledReason(reason: 'embedded'): void {
  if (!autoUpdater) disabledReason = reason
}

let autoUpdater: AppUpdater | null = null
let installRequested = false

const status: UpdaterStatus = { enabled: false, state: 'idle' }

function setStatus(patch: Partial<UpdaterStatus>): UpdaterStatus {
  Object.assign(status, patch)
  emitToAllWindows(UPDATER_EVENT, { ...status })
  return status
}

function disabledStatus(): UpdaterStatus {
  return { enabled: false, reason: disabledReason, state: 'idle' }
}

/** True while quitAndInstall is in flight — main's will-quit cleanup must not
 * block the quit or the installer never runs. */
export function isUpdateInstallInProgress(): boolean {
  return installRequested
}

/** True only after initUpdater() actually wired electron-updater (packaged
 * prod builds) — the smoke suite asserts this stays false there. */
export function isUpdaterActive(): boolean {
  return autoUpdater !== null
}

/**
 * Wire electron-updater and schedule the launch-time check. No-op outside
 * packaged production builds. Call once after the main window exists.
 */
export async function initUpdater(): Promise<void> {
  if (SMOKE_MODE || !app.isPackaged || autoUpdater) return
  // electron-updater is CJS and exposes `autoUpdater` via a defineProperty
  // getter that cjs-module-lexer cannot see — under ESM import it only shows
  // up on the default export.
  const mod = await import('electron-updater')
  const updater = (mod.autoUpdater ??
    (mod.default as { autoUpdater?: AppUpdater } | undefined)
      ?.autoUpdater) as AppUpdater | undefined
  if (!updater) return
  autoUpdater = updater
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  status.enabled = true
  autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking' }))
  autoUpdater.on('update-available', (info: UpdateInfo) =>
    setStatus({ state: 'available', version: info.version, message: undefined })
  )
  autoUpdater.on('update-not-available', (info: UpdateInfo) =>
    setStatus({ state: 'not-available', version: info.version })
  )
  autoUpdater.on('download-progress', (progress: ProgressInfo) =>
    setStatus({ state: 'downloading', percent: Math.round(progress.percent) })
  )
  autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
    setStatus({ state: 'downloaded', version: info.version, percent: 100 })
  )
  autoUpdater.on('error', (error: Error) =>
    setStatus({ state: 'error', message: error.message ?? String(error) })
  )

  // Launch-time check, slightly delayed so startup I/O settles first. The
  // renderer banner also checks on mount; a redundant check is cheap and
  // covers windows opened later.
  const timer = setTimeout(() => {
    void autoUpdater?.checkForUpdates().catch((error: Error) =>
      setStatus({ state: 'error', message: error.message ?? String(error) })
    )
  }, 5_000)
  timer.unref()
}

export function createUpdaterHandlers(): Record<string, CommandHandler> {
  return {
    updater_check: async (): Promise<UpdaterStatus> => {
      if (!autoUpdater) return disabledStatus()
      setStatus({ state: 'checking', message: undefined })
      try {
        await autoUpdater.checkForUpdates()
      } catch (error) {
        setStatus({ state: 'error', message: (error as Error).message ?? String(error) })
      }
      return { ...status }
    },
    updater_download: async (): Promise<UpdaterStatus> => {
      if (!autoUpdater) return disabledStatus()
      try {
        await autoUpdater.downloadUpdate()
      } catch (error) {
        setStatus({ state: 'error', message: (error as Error).message ?? String(error) })
      }
      return { ...status }
    },
    updater_install: async (): Promise<UpdaterStatus> => {
      if (!autoUpdater) return disabledStatus()
      installRequested = true
      // Let the IPC reply reach the renderer before the app starts quitting.
      setImmediate(() => autoUpdater?.quitAndInstall(false, true))
      return { ...status, state: 'downloaded' }
    },
  }
}
