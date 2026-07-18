/**
 * Tauri Global Shortcut Service - Desktop implementation
 *
 * Registration state is tracked locally (`this.registered`) because the
 * plugin's `isRegistered()` can go stale (tauri-apps/plugins-workspace#1012).
 * Registration errors propagate so the settings UI can show an inline error
 * when a combo is taken by another application.
 */

import { register, unregister, unregisterAll } from '@tauri-apps/plugin-global-shortcut'
import type { GlobalShortcutService } from './types'

/**
 * The actual toggle behavior lives in the Rust plugin `with_handler`
 * callback (see src-tauri/src/core/global_shortcut.rs), which fires for every
 * registered shortcut. The JS API still requires a handler argument, so a
 * no-op is passed here.
 */
const noopHandler = () => {}

export class TauriGlobalShortcutService implements GlobalShortcutService {
  private registered: string | null = null

  getRegistered(): string | null {
    return this.registered
  }

  async register(shortcut: string): Promise<void> {
    await register(shortcut, noopHandler)
    this.registered = shortcut
  }

  async unregister(shortcut: string): Promise<void> {
    await unregister(shortcut)
    if (this.registered === shortcut) {
      this.registered = null
    }
  }

  async remap(shortcut: string): Promise<void> {
    const previous = this.registered
    if (previous === shortcut) return

    if (previous) {
      try {
        await unregister(previous)
      } catch (error) {
        console.error('Error unregistering previous global shortcut:', error)
      }
    }

    try {
      await register(shortcut, noopHandler)
    } catch (error) {
      // Restore the previous registration so the user is not left without a
      // working hotkey when the new combo is taken by another app.
      if (previous) {
        try {
          await register(previous, noopHandler)
        } catch (restoreError) {
          console.error('Error restoring previous global shortcut:', restoreError)
        }
      }
      throw error
    }
    this.registered = shortcut
  }

  async unregisterAll(): Promise<void> {
    await unregisterAll()
    this.registered = null
  }
}
