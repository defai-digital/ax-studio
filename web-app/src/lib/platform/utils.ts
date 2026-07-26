declare const IS_WEB_APP: boolean

/**
 * @deprecated Electron is the only desktop runtime. This historical name now
 * means "a desktop bridge is present": the Electron preload injects both
 * `window.axElectron` and the legacy `__TAURI_INTERNALS__` marker (see
 * electron/src/preload.ts). Prefer isPlatformElectron() for Electron-specific
 * checks; this alias stays so existing call sites and tests keep working.
 */
export const isPlatformTauri = (): boolean => {
  if (typeof window !== 'undefined') {
    const w = window as unknown as Record<string, unknown>
    return w.axElectron != null || w.__TAURI_INTERNALS__ != null
  }
  // Non-browser environment (SSR / test) — fall back to the build-time constant
  if (typeof IS_WEB_APP === 'undefined') {
    return false
  }
  return !(IS_WEB_APP === true || (IS_WEB_APP as unknown as string) === 'true')
}

/**
 * True when running inside the Electron shell. The Electron preload injects
 * `window.axElectron` (and a `__TAURI_INTERNALS__` marker so the service layer
 * keeps taking the desktop bridge path — see electron/src/preload.ts), so this
 * check is orthogonal to isPlatformTauri().
 */
export const isPlatformElectron = (): boolean => {
  if (typeof window !== 'undefined') {
    return (window as unknown as Record<string, unknown>).axElectron != null
  }
  return false
}

/**
 * True only inside the Electron smoke suite (`electron . --smoke`); the
 * preload marks the bridge (electron/src/preload.ts). Boot behaviors that
 * would race the suite's fixtures (e.g. the local-API-server auto-start on
 * port 31419) gate on this.
 */
export const isElectronSmokeMode = (): boolean => {
  if (typeof window === 'undefined') return false
  const bridge = (window as unknown as Record<string, unknown>).axElectron as
    | { smoke?: boolean }
    | undefined
  return bridge?.smoke === true
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
