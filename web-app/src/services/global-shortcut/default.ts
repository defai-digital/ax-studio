/**
 * Default Global Shortcut Service - Web fallback (no-op)
 *
 * Global shortcuts require the desktop shell; in web mode every operation is
 * a no-op so the settings page can render without special-casing.
 */

import type { GlobalShortcutService } from './types'

export class DefaultGlobalShortcutService implements GlobalShortcutService {
  getRegistered(): string | null {
    return null
  }

  async register(_shortcut: string): Promise<void> {}

  async unregister(_shortcut: string): Promise<void> {}

  async remap(_shortcut: string): Promise<void> {}

  async unregisterAll(): Promise<void> {}
}
