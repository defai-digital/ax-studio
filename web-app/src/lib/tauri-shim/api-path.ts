// Electron shim for @tauri-apps/api/path — see docs/architecture/electron-migration-phase0-matrix.md
//
// Pure string operations, resolved locally (the Tauri versions are thin IPC
// wrappers around Rust's Path APIs; behavior here matches POSIX semantics,
// with Windows separators when the UA says Windows).
import { bridgeInvoke } from './bridge'

const isWindows =
  typeof navigator !== 'undefined' && /windows/i.test(navigator.userAgent)
const SEP = isWindows ? '\\' : '/'

export function sep(): string {
  return SEP
}

function normalize(path: string): string {
  const segments = path.split(/[\\/]+/)
  const out: string[] = []
  const isAbsolute = /^[\\/]/.test(path) || /^[A-Za-z]:[\\/]/.test(path)
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
      else if (!isAbsolute) out.push('..')
      continue
    }
    out.push(segment)
  }
  const prefix = isAbsolute ? (path.match(/^[A-Za-z]:/)?.[0] ?? '') + SEP : ''
  const joined = out.join(SEP)
  return prefix + joined || (isAbsolute ? prefix : '.')
}

export async function join(...paths: string[]): Promise<string> {
  const filtered = paths.filter((p) => p.length > 0)
  if (filtered.length === 0) return ''
  // An absolute segment discards everything before it (path.resolve semantics).
  let start = 0
  for (let i = 0; i < filtered.length; i++) {
    if (/^([A-Za-z]:)?[\\/]/.test(filtered[i])) start = i
  }
  return normalize(filtered.slice(start).join(SEP))
}

export async function dirname(path: string): Promise<string> {
  const normalized = normalize(path)
  const index = normalized.replace(/[\\/]+$/, '').search(/[^\\/]+$/)
  const dir = index <= 0 ? normalized.slice(0, 1) : normalized.slice(0, index)
  return dir.replace(/[\\/]+$/, '') || (normalized.startsWith(SEP) ? SEP : '.')
}

export async function basename(path: string, ext?: string): Promise<string> {
  const base = normalize(path).split(/[\\/]+/).pop() ?? ''
  if (ext && base.endsWith(ext)) return base.slice(0, base.length - ext.length)
  return base
}

export async function extname(path: string): Promise<string> {
  const base = (path.split(/[\\/]+/).pop() ?? '').replace(/^\.+/, '')
  const index = base.lastIndexOf('.')
  return index > 0 ? base.slice(index + 1) : ''
}

let cachedAppDataDir: Promise<string> | null = null

export async function appDataDir(): Promise<string> {
  if (!cachedAppDataDir) {
    cachedAppDataDir = bridgeInvoke<string>('get_app_data_folder_path')
  }
  return cachedAppDataDir
}

export async function homeDir(): Promise<string> {
  // Mirrors the Rust get_user_home_path, which returns the data folder.
  return bridgeInvoke<string>('get_user_home_path')
}
