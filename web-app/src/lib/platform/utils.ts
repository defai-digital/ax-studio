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

export type InferenceProfile =
  | 'macos-local'
  | 'windows-x64-local'
  | 'api-only'
  | 'unsupported'

function runtimePlatform(): string {
  if (typeof navigator === 'undefined') return ''
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string; architecture?: string }
  }
  return [
    nav.userAgentData?.platform,
    nav.userAgentData?.architecture,
    nav.platform,
    nav.userAgent,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function isIPad(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { maxTouchPoints?: number }
  return (
    /ipad/.test(runtimePlatform()) ||
    (navigator.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1)
  )
}

/** Product-level inference policy, independent of browser user-agent quirks. */
export const getInferenceProfile = (): InferenceProfile => {
  const platform = runtimePlatform()
  if (isIPad()) return 'api-only'
  if (/mac/.test(platform) && !/iphone|ipad|ipod/.test(platform)) {
    return 'macos-local'
  }
  if (/win/.test(platform)) {
    return /arm64|aarch64|\barm\b/.test(platform)
      ? 'api-only'
      : 'windows-x64-local'
  }
  return 'unsupported'
}

export const isApiOnlyPlatform = (): boolean =>
  getInferenceProfile() === 'api-only'

export const supportsLocalLlamaCpp = (): boolean =>
  getInferenceProfile() === 'macos-local' ||
  getInferenceProfile() === 'windows-x64-local'

export const supportsAxEngine = (): boolean =>
  getInferenceProfile() === 'macos-local'

/** Detect if running on macOS desktop. */
const isMacOS = (): boolean => getInferenceProfile() === 'macos-local'

/**
 * Check if MLX models are supported on this platform.
 * MLX requires macOS with Apple Silicon (M1/M2/M3/M4).
 */
export const isMlxSupported = (): boolean => {
  return isMacOS()
}
