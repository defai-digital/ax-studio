// Window command handlers (`window_*`) backing the @tauri-apps/api/window and
// webviewWindow shims.
import { BrowserWindow, nativeTheme } from 'electron'
import { str } from './args.js'
import type { CommandHandler } from './registry.js'

type Args = Record<string, unknown>

function focusedWindow(): BrowserWindow {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win) throw new Error('window command: no window available')
  return win
}

function windowByLabel(label: string | undefined): BrowserWindow {
  if (!label || label === 'main') return focusedWindow()
  const win = BrowserWindow.getAllWindows().find((w) => w.title === label || String(w.id) === label)
  if (!win) throw new Error(`window command: no window with label '${label}'`)
  return win
}

export function createWindowHandlers(
  createChildWindow: (label: string, options: Record<string, unknown>) => BrowserWindow
): Record<string, CommandHandler> {
  return {
    window_set_focus: (args) => windowByLabel(str(args?.label)).focus(),
    window_minimize: (args) => windowByLabel(str(args?.label)).minimize(),
    window_maximize: (args) => windowByLabel(str(args?.label)).maximize(),
    window_unmaximize: (args) => windowByLabel(str(args?.label)).unmaximize(),
    window_toggle_maximize: (args) => {
      const win = windowByLabel(str(args?.label))
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    },
    window_is_maximized: (args) => windowByLabel(str(args?.label)).isMaximized(),
    window_close: (args) => windowByLabel(str(args?.label)).close(),
    window_hide: (args) => windowByLabel(str(args?.label)).hide(),
    window_show: (args) => {
      const win = windowByLabel(str(args?.label))
      win.show()
      win.focus()
    },
    window_set_title: (args) => {
      const title = str(args?.title)
      if (!title) throw new Error('window_set_title error: Invalid argument')
      windowByLabel(str(args?.label)).setTitle(title)
    },
    window_set_theme: (args) => {
      const theme = str(args?.theme)
      nativeTheme.themeSource =
        theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : 'system'
    },
    window_theme: () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'),
    // Electron has no equivalent of Tauri's startDragging; Phase 1 windows use
    // the native frame, so this is a deliberate no-op. TODO(phase-4): revisit
    // with a frameless window + `-webkit-app-region: drag` if the design
    // calls for custom chrome.
    window_start_dragging: () => undefined,
    window_get_all: () =>
      BrowserWindow.getAllWindows().map((win, index) => (index === 0 ? 'main' : String(win.id))),
    window_create: (args) => {
      const label = str(args?.label)
      if (!label) throw new Error('window_create error: Invalid argument')
      const options = (args?.options ?? {}) as Record<string, unknown>
      createChildWindow(label, options)
      return label
    },
  }
}
