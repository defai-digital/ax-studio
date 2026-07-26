// Platform gates, mirroring AX Code's platform.ts behavior: Apple-Silicon
// macOS is a hard requirement; macOS < 26 and < 64 GB RAM are warnings, not
// hard blocks.
import os from 'node:os'

export interface AxEnginePlatformInfo {
  supported: boolean
  warnings: string[]
  detail?: string
}

/** ax-engine is validated on macOS 26+; older versions only earn a warning. */
const MIN_MACOS_MAJOR = 26
const RECOMMENDED_MEMORY_BYTES = 64 * 1024 * 1024 * 1024

function macOSMajorVersion(): number | null {
  if (process.platform !== 'darwin') return null
  // os.release() is the Darwin kernel version. Darwin 20–24 map to macOS
  // 11–15 (darwin - 9); Apple renumbered with macOS 26 = Darwin 25.
  const darwinMajor = Number.parseInt(os.release().split('.')[0] ?? '', 10)
  if (!Number.isFinite(darwinMajor)) return null
  return darwinMajor >= 25 ? darwinMajor + 1 : darwinMajor - 9
}

export function checkAxEnginePlatform(): AxEnginePlatformInfo {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    return {
      supported: false,
      warnings: [],
      detail: `ax-engine requires macOS on Apple Silicon (got ${process.platform}/${process.arch})`,
    }
  }
  const warnings: string[] = []
  const macMajor = macOSMajorVersion()
  if (macMajor !== null && macMajor < MIN_MACOS_MAJOR) {
    warnings.push(
      `ax-engine is validated on macOS ${MIN_MACOS_MAJOR}+; this host reports macOS ~${macMajor}. Continuing anyway.`,
    )
  }
  if (os.totalmem() < RECOMMENDED_MEMORY_BYTES) {
    warnings.push(
      `ax-engine guidance is 64 GB+ unified memory; this host has ${Math.round(os.totalmem() / 1024 ** 3)} GB. Large models may not fit.`,
    )
  }
  return { supported: true, warnings }
}
