// Electron preload — exposes the `window.axElectron` bridge consumed by the
// renderer-side Tauri shim (web-app/src/lib/tauri-shim/). Compiled to CommonJS
// (dist-preload/) because Electron preload scripts cannot be ESM `.js` files.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

export type AxBridgeEnvelope =
  | { kind: 'event'; name: string; payload: unknown }
  | { kind: 'channel'; channelId: number; payload: unknown }

// True when the shell runs `electron . --smoke`: lets the renderer skip
// boot behaviors (local-API-server auto-start on 31419) that would race
// the smoke suite's own proxy/ax-engine port checks. Main passes the flag
// via webPreferences.additionalArguments (renderer argv ≠ main argv).
const SMOKE_MODE = process.argv.includes('--ax-smoke')

const api = {
  smoke: SMOKE_MODE,
  invoke: (cmd: string, args?: unknown): Promise<unknown> =>
    ipcRenderer.invoke('ax:invoke', cmd, args),
  sendEvent: (name: string, payload?: unknown): void => {
    ipcRenderer.send('ax:event-emit', { name, payload })
  },
  onEvent: (callback: (envelope: AxBridgeEnvelope) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, envelope: AxBridgeEnvelope) =>
      callback(envelope)
    ipcRenderer.on('ax:event', listener)
    return () => {
      ipcRenderer.removeListener('ax:event', listener)
    }
  },
}

contextBridge.exposeInMainWorld('axElectron', api)

// The web-app's `isPlatformTauri()` feature-detects `window.__TAURI_INTERNALS__`
// (web-app/src/lib/platform/utils.ts) to route every service call down the
// desktop bridge path. Injecting a marker object keeps those branches on the
// IPC path; all actual `@tauri-apps/*` calls are intercepted by the shim.
contextBridge.exposeInMainWorld('__TAURI_INTERNALS__', {})
