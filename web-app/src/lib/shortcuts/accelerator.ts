/**
 * Global Shortcut Accelerator Helpers
 *
 * Converts captured KeyboardEvents into Tauri accelerator strings
 * (e.g. "CmdOrCtrl+Shift+Space") for the global wake hotkey, and back into
 * display parts for the settings UI. Pure functions; no DOM or Tauri imports.
 */

/** Keys that are only modifiers — pressing them alone is not a valid combo. */
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])

/** KeyboardEvent.key values that need a Tauri-specific name. */
const KEY_NAME_MAP: Record<string, string> = {
  ' ': 'Space',
  Spacebar: 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc',
}

export interface AcceleratorModifiers {
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/**
 * Builds a Tauri accelerator string from a captured key event.
 * Returns null when the event is a pure modifier press (nothing to record yet).
 * Meta and Control are both mapped to the cross-platform `CmdOrCtrl`.
 */
export function acceleratorFromEvent(
  event: { key: string } & AcceleratorModifiers
): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null

  const parts: string[] = []
  if (event.metaKey || event.ctrlKey) parts.push('CmdOrCtrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')

  const mapped = KEY_NAME_MAP[event.key]
  const key = mapped ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key)
  parts.push(key)

  return parts.join('+')
}

/**
 * Splits an accelerator string into display parts, preserving order.
 * `CmdOrCtrl` is returned as-is; the UI renders it with PlatformMetaKey.
 */
export function acceleratorToKeys(accelerator: string): string[] {
  return accelerator
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
}
