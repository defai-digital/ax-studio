// Electron shim for @tauri-apps/api/webviewWindow — see docs/architecture/electron-migration-phase0-matrix.md
import { bridgeInvoke } from './bridge'
import { Window } from './api-window'

export interface WebviewWindowOptions {
  url?: string
  title?: string
  width?: number
  height?: number
  center?: boolean
  resizable?: boolean
  minimizable?: boolean
  maximizable?: boolean
  closable?: boolean
  fullscreen?: boolean
  theme?: 'light' | 'dark'
}

export class WebviewWindow extends Window {
  /**
   * Matches Tauri's synchronous constructor: window creation is kicked off
   * asynchronously and failures are logged (Tauri surfaces them via the
   * `tauri://error` event instead of a rejected promise).
   */
  constructor(label: string, options: WebviewWindowOptions = {}) {
    super(label)
    if (Object.keys(options).length > 0) {
      void bridgeInvoke('window_create', { label, options }).catch((error) => {
        console.error(`[tauri-shim] failed to create window '${label}':`, error)
      })
    }
  }

  static async getByLabel(label: string): Promise<WebviewWindow | null> {
    const labels = await bridgeInvoke<string[]>('window_get_all')
    if (label === 'main' || labels.includes(label)) return new WebviewWindow(label)
    return null
  }

  static async getAll(): Promise<WebviewWindow[]> {
    const labels = await bridgeInvoke<string[]>('window_get_all')
    return labels.map((label) => new WebviewWindow(label))
  }
}

let currentWebviewWindow: WebviewWindow | null = null

export function getCurrentWebviewWindow(): WebviewWindow {
  if (!currentWebviewWindow) currentWebviewWindow = new WebviewWindow('main')
  return currentWebviewWindow
}

export async function getAllWebviewWindows(): Promise<WebviewWindow[]> {
  return WebviewWindow.getAll()
}
