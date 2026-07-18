/**
 * Global Shortcut Service Types
 * Types for the global wake hotkey (tech spec DESKTOP-NATIVE §2.A)
 */

export const GLOBAL_WAKE_EVENT = 'global-wake'

export const DEFAULT_QUICK_LAUNCH_SHORTCUT = 'CmdOrCtrl+Shift+Space'

export interface GlobalShortcutService {
  /**
   * Currently registered shortcut, tracked by the service itself.
   * The plugin's own `isRegistered()` has a stale-state bug
   * (tauri-apps/plugins-workspace#1012), so callers must rely on this instead.
   */
  getRegistered(): string | null
  /** Register a shortcut. Rejects when the combo is taken by another app. */
  register(shortcut: string): Promise<void>
  /** Unregister a shortcut. */
  unregister(shortcut: string): Promise<void>
  /**
   * Atomically move the registration from the tracked shortcut to a new one.
   * On failure the previous registration is restored and the error rethrown.
   */
  remap(shortcut: string): Promise<void>
  /** Unregister everything. */
  unregisterAll(): Promise<void>
}
