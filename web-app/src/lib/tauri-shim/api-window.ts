// Electron shim for @tauri-apps/api/window — see docs/architecture/electron-migration-phase0-matrix.md
import { bridgeInvoke } from './bridge'

export type Theme = 'light' | 'dark'
export const Theme = {
  Light: 'light' as Theme,
  Dark: 'dark' as Theme,
}

export interface CloseRequestedEvent {
  preventDefault(): void
}

export class Window {
  constructor(readonly label: string) {}

  private cmd<T>(name: string, extra?: Record<string, unknown>): Promise<T> {
    return bridgeInvoke<T>(name, { label: this.label, ...extra })
  }

  setFocus(): Promise<void> {
    return this.cmd('window_set_focus')
  }
  minimize(): Promise<void> {
    return this.cmd('window_minimize')
  }
  maximize(): Promise<void> {
    return this.cmd('window_maximize')
  }
  unmaximize(): Promise<void> {
    return this.cmd('window_unmaximize')
  }
  toggleMaximize(): Promise<void> {
    return this.cmd('window_toggle_maximize')
  }
  isMaximized(): Promise<boolean> {
    return this.cmd('window_is_maximized')
  }
  close(): Promise<void> {
    return this.cmd('window_close')
  }
  hide(): Promise<void> {
    return this.cmd('window_hide')
  }
  show(): Promise<void> {
    return this.cmd('window_show')
  }
  setTitle(title: string): Promise<void> {
    return this.cmd('window_set_title', { title })
  }
  setTheme(theme: Theme | null): Promise<void> {
    return this.cmd('window_set_theme', { theme })
  }
  theme(): Promise<Theme | null> {
    return this.cmd<Theme>('window_theme')
  }
  startDragging(): Promise<void> {
    return this.cmd('window_start_dragging')
  }

  async onCloseRequested(
    handler: (event: CloseRequestedEvent) => void | Promise<void>
  ): Promise<() => void> {
    // Phase 1 approximation: Electron windows close natively; the closest
    // renderer-side signal is beforeunload. TODO(phase-4): wire a real
    // close-requested event from main when multi-window lands.
    const listener = () => {
      void handler({ preventDefault: () => {} })
    }
    window.addEventListener('beforeunload', listener)
    return () => window.removeEventListener('beforeunload', listener)
  }
}

let currentWindow: Window | null = null

export function getCurrentWindow(): Window {
  if (!currentWindow) currentWindow = new Window('main')
  return currentWindow
}

export async function getAllWindows(): Promise<Window[]> {
  const labels = await bridgeInvoke<string[]>('window_get_all')
  return labels.map((label) => new Window(label))
}
