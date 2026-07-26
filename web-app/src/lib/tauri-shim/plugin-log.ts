// Electron shim for @tauri-apps/plugin-log — see docs/architecture/electron-migration-phase0-matrix.md
//
// TODO(phase-4): forward records into the main-process log file via IPC.
// Phase 1 logs to the renderer console (visible via ELECTRON_ENABLE_LOGGING).

type LogFn = (message: string) => Promise<void>

const make =
  (level: 'trace' | 'debug' | 'info' | 'warn' | 'error'): LogFn =>
  async (message) => {
    console[level](message)
  }

export const trace = make('trace')
export const debug = make('debug')
export const info = make('info')
export const warn = make('warn')
export const error = make('error')
