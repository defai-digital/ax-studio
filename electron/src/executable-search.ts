import fs from 'node:fs'
import path from 'node:path'

export function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK)
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

/**
 * Finder does not necessarily inherit the user's interactive shell PATH.
 * Split/join follow `process.platform` rather than the host `path` module so
 * Windows entries (`;` separator, drive letters) resolve the same way when the
 * platform is simulated off-Windows. In production the two APIs always agree.
 */
export function findSystemExecutable(name: string): string | null {
  const pathApi = process.platform === 'win32' ? path.win32 : path.posix
  const directories = (process.env.PATH ?? '')
    .split(pathApi.delimiter)
    .filter(Boolean)
  if (process.platform === 'darwin') {
    directories.push('/opt/homebrew/bin', '/usr/local/bin')
  }
  for (const directory of new Set(directories)) {
    const candidate = pathApi.join(directory, name)
    if (isExecutable(candidate)) return candidate
  }
  return null
}
