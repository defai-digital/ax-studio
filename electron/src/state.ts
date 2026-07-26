// Shared main-process state: data-folder resolution, persisted configuration,
// path-approval tracking, pending OS open-file requests, and the app log.
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export const APP_DISPLAY_NAME = 'AX Studio'
const CONFIGURATION_FILE_NAME = 'configuration.json'
const LOG_FILE_NAME = 'app.log'
const MAX_LOG_FILE_BYTES = 1024 * 1024

export interface AppConfiguration {
  data_folder: string
}

/**
 * Paths outside the data folder that the user explicitly granted access to
 * (file dialogs, OS open-file requests). Mirrors the Rust
 * `approved_save_paths` / dialog grants; in-memory only, per session.
 */
const approvedPaths = new Set<string>()

let pendingOpenFiles: string[] = []

export function userDataPath(...parts: string[]): string {
  return path.join(app.getPath('userData'), ...parts)
}

export function configurationFilePath(): string {
  return userDataPath(CONFIGURATION_FILE_NAME)
}

export function defaultDataFolderPath(): string {
  return path.join(app.getPath('appData'), APP_DISPLAY_NAME, 'data')
}

export function getAppConfigurations(): AppConfiguration {
  const fallback: AppConfiguration = { data_folder: defaultDataFolderPath() }
  const configFile = configurationFilePath()
  try {
    if (!fs.existsSync(configFile)) {
      fs.mkdirSync(path.dirname(configFile), { recursive: true })
      fs.writeFileSync(configFile, JSON.stringify(fallback, null, 2))
      return fallback
    }
    const parsed = JSON.parse(fs.readFileSync(configFile, 'utf8')) as Partial<AppConfiguration>
    if (typeof parsed.data_folder === 'string' && parsed.data_folder.length > 0) {
      return { data_folder: parsed.data_folder }
    }
    return fallback
  } catch (error) {
    console.error('[electron] failed to read configuration, using defaults:', error)
    return fallback
  }
}

export function updateAppConfiguration(configuration: AppConfiguration): void {
  const configFile = configurationFilePath()
  fs.mkdirSync(path.dirname(configFile), { recursive: true })
  const temp = `${configFile}.tmp`
  fs.writeFileSync(temp, JSON.stringify(configuration, null, 2))
  fs.renameSync(temp, configFile)
}

/**
 * Embed API (`registerAxStudioBridge({ dataFolder })`): pins the data folder
 * for the whole session, ignoring userData/configuration.json and any later
 * `change_app_data_folder` writes. Null means "use the persisted config".
 */
let dataFolderOverride: string | null = null

export function setDataFolderOverride(folder: string | null): void {
  dataFolderOverride = folder ? path.resolve(folder) : null
}

export function getAppDataFolderPath(): string {
  return dataFolderOverride ?? getAppConfigurations().data_folder
}

/** Canonicalize the deepest existing ancestor so symlink escapes are caught. */
export function canonicalizeLoose(target: string): string {
  let current = path.resolve(target)
  const missing: string[] = []
  for (;;) {
    try {
      const canonical = fs.realpathSync(current)
      return [canonical, ...missing.reverse()].join(path.sep)
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return path.resolve(target)
      missing.push(path.basename(current))
      current = parent
    }
  }
}

export function canonicalDataFolder(): string {
  const folder = getAppDataFolderPath()
  try {
    fs.mkdirSync(folder, { recursive: true })
    return fs.realpathSync(folder)
  } catch {
    return path.resolve(folder)
  }
}

/**
 * Resolve a bridge path the same way the Rust `resolve_path` helper does:
 * `file:`-prefixed and relative paths are data-folder-relative; absolute
 * paths must live inside the data folder unless explicitly approved.
 */
export function resolveDataPath(input: string, command: string): string {
  if (!input || input.length > 4096 || /[\u0000-\u001F]/.test(input)) {
    throw new Error(`${command} error: Invalid argument`)
  }
  if (input.startsWith('http://') || input.startsWith('https://')) {
    throw new Error(`${command}: network URLs are not valid filesystem paths`)
  }

  const dataFolder = getAppDataFolderPath()
  let candidate: string
  if (input.startsWith('file:/') || input.startsWith('file:\\')) {
    const relative = input
      .replace(/^file:[/\\]+/, '')
      .replace(/^[/\\]+/, '')
    candidate = path.join(dataFolder, relative)
  } else {
    candidate = input
  }

  const resolved = canonicalizeLoose(
    path.isAbsolute(candidate) ? candidate : path.join(dataFolder, candidate)
  )
  if (isPathAllowed(resolved)) return resolved

  throw new Error(
    `Path traversal blocked: ${resolved} is outside app data folder ${canonicalDataFolder()}`
  )
}

export function isPathAllowed(resolved: string): boolean {
  const root = canonicalDataFolder()
  if (resolved === root || resolved.startsWith(root + path.sep)) return true
  if (approvedPaths.has(resolved)) return true
  // Allow reads of files inside an approved directory (e.g. a picked folder).
  for (const approved of approvedPaths) {
    if (resolved.startsWith(approved + path.sep)) return true
  }
  return false
}

export function approvePath(p: string): void {
  try {
    approvedPaths.add(canonicalizeLoose(p))
  } catch {
    approvedPaths.add(path.resolve(p))
  }
}

export function bufferOpenFiles(paths: string[]): void {
  for (const p of paths) approvePath(p)
  pendingOpenFiles.push(...paths)
}

export function takePendingOpenFiles(): string[] {
  const drained = pendingOpenFiles
  pendingOpenFiles = []
  return drained
}

// ─── App log ────────────────────────────────────────────────────────────────

export function logFilePath(): string {
  return userDataPath('logs', LOG_FILE_NAME)
}

export function appendLog(message: string, fileName?: string): void {
  const tag = fileName ? `[browser:${fileName}]` : '[browser]'
  const line = `${new Date().toISOString()} ${tag} ${message.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}\n`
  try {
    const file = logFilePath()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_LOG_FILE_BYTES) {
      fs.renameSync(file, `${file}.1`)
    }
    fs.appendFileSync(file, line)
  } catch (error) {
    console.error('[electron] failed to append log:', error)
  }
}

export function readLogs(): string {
  try {
    return fs.readFileSync(logFilePath(), 'utf8')
  } catch {
    return ''
  }
}
