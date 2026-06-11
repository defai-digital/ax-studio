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

export type Platform = 'tauri' | 'web'

export const getCurrentPlatform = (): Platform => {
  return isPlatformTauri() ? 'tauri' : 'web'
}
