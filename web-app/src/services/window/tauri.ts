/**
 * Tauri Window Service - Desktop implementation
 */

import { WebviewWindow } from '@/lib/tauri-shim/api-webview-window'
import type { WindowConfig, WebviewWindowInstance, WindowService } from './types'
import { themeStorageSchema } from '@/schemas/window.schema'
import { safeStorageGetItem } from '@/lib/storage/storage'

function createWindowInstance(
  label: string,
  webviewWindow: WebviewWindow
): WebviewWindowInstance {
  return {
    label,
    async close() {
      await webviewWindow.close()
    },
    async show() {
      await webviewWindow.show()
    },
    async hide() {
      await webviewWindow.hide()
    },
    async focus() {
      await webviewWindow.setFocus()
    },
    async setTitle(title: string) {
      await webviewWindow.setTitle(title)
    },
  }
}

export class TauriWindowService implements WindowService {
  async createWebviewWindow(
    config: WindowConfig
  ): Promise<WebviewWindowInstance> {
    try {
      // Get current theme from localStorage
      const storedTheme = safeStorageGetItem(
        localStorage,
        'theme',
        'TauriWindowService'
      )
      let theme: 'light' | 'dark' | undefined = undefined

      if (storedTheme) {
        try {
          const themeData = themeStorageSchema.safeParse(JSON.parse(storedTheme))
          if (themeData.success) {
            const activeTheme = themeData.data.state?.activeTheme
            const isDark = themeData.data.state?.isDark
            if (activeTheme === 'dark' || (activeTheme === 'auto' && isDark)) {
              theme = 'dark'
            } else if (activeTheme === 'light' || (activeTheme === 'auto' && !isDark)) {
              theme = 'light'
            }
            // 'auto' with no isDark → undefined, let OS decide
          } else {
            console.warn('Theme localStorage data did not match expected schema:', themeData.error.message)
          }
        } catch (e) {
          console.warn('Failed to parse theme from localStorage:', e)
        }
      }

      const webviewWindow = new WebviewWindow(config.label, {
        url: config.url,
        title: config.title,
        width: config.width,
        height: config.height,
        center: config.center,
        resizable: config.resizable,
        minimizable: config.minimizable,
        maximizable: config.maximizable,
        closable: config.closable,
        fullscreen: config.fullscreen,
        theme: theme,
      })

      // Setup theme listener for this window
      this.setupThemeListenerForWindow(webviewWindow)

      return createWindowInstance(config.label, webviewWindow)
    } catch (error) {
      console.error('Error creating Tauri window:', error)
      throw error
    }
  }

  async getWebviewWindowByLabel(
    label: string
  ): Promise<WebviewWindowInstance | null> {
    try {
      const existingWindow = await WebviewWindow.getByLabel(label)

      if (existingWindow) {
        return createWindowInstance(label, existingWindow)
      }

      return null
    } catch (error) {
      console.error('Error getting Tauri window by label:', error)
      return null
    }
  }

  async openWindow(config: WindowConfig): Promise<void> {
    // Check if window already exists first
    const existing = await this.getWebviewWindowByLabel(config.label)
    if (existing) {
      await existing.show()
      await existing.focus()
    } else {
      await this.createWebviewWindow(config)
    }
  }

  private async openWindowWithLogging(
    config: WindowConfig,
    logLabel: string
  ): Promise<void> {
    try {
      await this.openWindow(config)
    } catch (error) {
      console.error(`Error opening ${logLabel} in Tauri:`, error)
      throw error
    }
  }

  async openLogsWindow(): Promise<void> {
    return this.openWindowWithLogging(
      {
        url: '/logs',
        label: 'logs-app-window',
        title: 'App Logs - AX Studio',
        width: 800,
        height: 600,
        resizable: true,
        center: true,
      },
      'logs window'
    )
  }

  async openSystemMonitorWindow(): Promise<void> {
    return this.openWindowWithLogging(
      {
        url: '/system-monitor',
        label: 'system-monitor-window',
        title: 'System Monitor - AX Studio',
        width: 1000,
        height: 700,
        resizable: true,
        center: true,
      },
      'system monitor window'
    )
  }

  async openLocalApiServerLogsWindow(): Promise<void> {
    return this.openWindowWithLogging(
      {
        url: '/local-api-server/logs',
        label: 'logs-window-local-api-server',
        title: 'Local API Server Logs - AX Studio',
        width: 800,
        height: 600,
        resizable: true,
        center: true,
      },
      'local API server logs window'
    )
  }

  private setupThemeListenerForWindow(window: WebviewWindow): void {
    // Listen to theme change events from Tauri backend. `listen()` returns
    // an UnlistenFn that MUST be called when the window closes — otherwise
    // every new window registers a new global `theme-changed` listener
    // that's never torn down, and stale listeners fire callbacks on
    // destroyed WebviewWindow handles.
    let unlisten: (() => void) | null = null
    let closed = false

    import('@/lib/tauri-shim/api-event')
      .then(({ listen }) =>
        listen<string>('theme-changed', async (event) => {
          const theme = event.payload
          try {
            if (theme === 'dark') {
              await window.setTheme('dark')
            } else if (theme === 'light') {
              await window.setTheme('light')
            } else {
              await window.setTheme(null)
            }
          } catch (err) {
            console.error('Failed to update window theme:', err)
          }
        })
      )
      .then((unlistenFn) => {
        if (closed) {
          // Window already closed before listen() resolved — clean up
          // immediately so the listener doesn't leak.
          unlistenFn()
          return
        }
        unlisten = unlistenFn
      })
      .catch((err) => {
        console.error('Failed to setup theme listener for window:', err)
      })

    // Subscribe to the window's close event and drop the listener.
    window
      .onCloseRequested(() => {
        closed = true
        if (unlisten) {
          unlisten()
          unlisten = null
        }
      })
      .catch((err) => {
        console.error('Failed to register onCloseRequested for theme listener cleanup:', err)
      })
  }
}
