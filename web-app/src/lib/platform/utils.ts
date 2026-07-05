declare const IS_WEB_APP: boolean

export const isPlatformTauri = (): boolean => {
  // __TAURI_INTERNALS__ is injected exclusively by the Tauri WebView before any JS runs.
  // It is never present when the app is opened in a regular browser (e.g. Vite dev server).
  // vite.config.ts always sets IS_WEB_APP=false so we cannot rely on it to distinguish
  // Tauri from browser; the runtime check is authoritative.
  if (typeof window !== 'undefined') {
    return (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ != null
  }
  // Non-browser environment (SSR / test) — fall back to the build-time constant
  if (typeof IS_WEB_APP === 'undefined') {
    return false
  }
  return !(IS_WEB_APP === true || (IS_WEB_APP as unknown as string) === 'true')
}

/**
 * Detect if running on macOS. MLX models only work on macOS with Apple Silicon.
 * Uses navigator.platform which works in both browser and Tauri WebView.
 */
export const isMacOS = (): boolean => {
  if (typeof navigator !== 'undefined') {
    return /Mac|iPod|iPhone|iPad/.test(navigator.platform)
  }
  return false
}

/**
 * Check if MLX models are supported on this platform.
 * MLX requires macOS with Apple Silicon (M1/M2/M3/M4).
 */
export const isMlxSupported = (): boolean => {
  return isMacOS()
}
