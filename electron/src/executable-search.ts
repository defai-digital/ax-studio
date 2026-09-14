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

/** Finder does not necessarily inherit the user's interactive shell PATH. */
export function findSystemExecutable(name: string): string | null {
  const directories = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
  if (process.platform === 'darwin') {
    directories.push('/opt/homebrew/bin', '/usr/local/bin')
  }
  for (const directory of new Set(directories)) {
    const candidate = path.join(directory, name)
    if (isExecutable(candidate)) return candidate
  }
  return null
}
