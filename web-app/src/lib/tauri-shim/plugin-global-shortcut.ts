// Electron shim for @tauri-apps/plugin-global-shortcut — see docs/architecture/electron-migration-phase0-matrix.md
//
// TODO(phase-4): back with Electron globalShortcut via IPC. Stubbed as loud
// no-ops; the shortcuts settings page is slated for removal in the migration.

export type ShortcutHandler = (event: { shortcut: string; state: 'Pressed' | 'Released' }) => void

export async function register(
  shortcut: string,
  _handler: ShortcutHandler
): Promise<void> {
  console.warn(`[tauri-shim] global-shortcut register('${shortcut}') is a phase-4 stub`)
}

export async function unregister(shortcut: string): Promise<void> {
  console.warn(`[tauri-shim] global-shortcut unregister('${shortcut}') is a phase-4 stub`)
}

export async function unregisterAll(): Promise<void> {
  console.warn('[tauri-shim] global-shortcut unregisterAll() is a phase-4 stub')
}

export async function isRegistered(_shortcut: string): Promise<boolean> {
  return false
}
