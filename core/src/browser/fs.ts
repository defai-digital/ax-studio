import { FileStat } from '../types'

const decodePathRecursively = (path: string): string => {
  let decoded = path

  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch {
      break
    }
  }

  return decoded.normalize('NFKC')
}

/**
 * Validates a file path to prevent path traversal attacks.
 * @param path - The path to validate
 * @throws Error if the path contains traversal attempts or invalid characters
 */
const validatePath = (path: string): void => {
  if (typeof path !== 'string') {
    throw new Error(`Path must be a string, got ${typeof path}`)
  }

  const normalizedPath = decodePathRecursively(path)

  // Check for path traversal attempts, including encoded and normalized variants.
  if (
    normalizedPath.includes('..') ||
    normalizedPath.includes('../') ||
    normalizedPath.includes('..\\')
  ) {
    throw new Error(`Path traversal not allowed: ${path}`)
  }

  // Additional validation: no null bytes, control characters
  if (normalizedPath.includes('\0') || /[\x00-\x1F\x7F-\x9F]/.test(normalizedPath)) {
    throw new Error(`Invalid characters in path: ${path}`)
  }

  // Allow absolute paths - the Tauri backend should handle sandboxing
  // Only reject obvious traversal attempts and invalid characters
}

/**
 * Browser fs module — thin validated wrappers around the Tauri desktop bridge.
 *
 * Every public method lives directly on this object, so adding a new function
 * automatically makes it available to consumers (no separate export list needed).
 */
export const fs = {
  /**
   * Writes data to a file at the specified path.
   * Historical note: keeps a Sync suffix for API compatibility,
   * but still returns a Promise because the desktop bridge is asynchronous.
   */
  writeFileSync(path: string, data: string): Promise<void> {
    validatePath(path)
    return globalThis.core.api?.writeFileSync({ args: [path, data] })
  },

  /**
   * Writes blob data to a file at the specified path.
   * @param path - The path to file.
   * @param data - The blob data.
   */
  writeBlob(path: string, data: string): Promise<void> {
    validatePath(path)
    return globalThis.core.api?.writeBlob(path, data)
  },

  /**
   * Reads the contents of a file at the specified path.
   * Historical note: keeps a Sync suffix for API compatibility,
   * but still returns a Promise because the desktop bridge is asynchronous.
   */
  readFileSync(path: string): Promise<string> {
    validatePath(path)
    return globalThis.core.api?.readFileSync({ args: [path] })
  },

  /**
   * Check whether the file exists.
   * Historical note: keeps a Sync suffix for API compatibility,
   * but still returns a Promise because the desktop bridge is asynchronous.
   */
  existsSync(path: string): Promise<boolean> {
    validatePath(path)
    return globalThis.core.api?.existsSync({ args: [path] })
  },

  /**
   * List the directory files.
   * Historical note: keeps a Sync suffix for API compatibility,
   * but still returns a Promise because the desktop bridge is asynchronous.
   */
  readdirSync(path: string): Promise<string[]> {
    validatePath(path)
    return globalThis.core.api?.readdirSync({ args: [path] })
  },

  /**
   * Creates a directory at the specified path.
   */
  mkdir(path: string): Promise<void> {
    validatePath(path)
    return globalThis.core.api?.mkdir({ args: [path] })
  },

  /**
   * Removes a directory at the specified path.
   */
  rm(path: string): Promise<void> {
    validatePath(path)
    return globalThis.core.api?.rm({ args: [path] })
  },

  /**
   * Moves a file from the source path to the destination path.
   */
  mv(from: string, to: string): Promise<void> {
    validatePath(from)
    validatePath(to)
    return globalThis.core.api?.mv({ args: [from, to] })
  },

  /**
   * Deletes a file from the local file system.
   * @param path - The path of the file to delete.
   */
  unlinkSync(path: string): Promise<void> {
    validatePath(path)
    return globalThis.core.api?.unlinkSync({ args: [path] })
  },

  /**
   * Appends data to a file at the specified path.
   */
  appendFileSync(path: string, data: string): Promise<void> {
    validatePath(path)
    return globalThis.core.api?.appendFileSync({ args: [path, data] })
  },

  /**
   * Copies a file from the source path to the destination path.
   */
  copyFile(src: string, dest: string): Promise<void> {
    validatePath(src)
    validatePath(dest)
    return globalThis.core.api?.copyFile(src, dest)
  },

  /**
   * Gets the list of gguf files in a directory.
   *
   * @param paths - The paths to search for gguf files.
   */
  getGgufFiles(paths: string[]): Promise<{gguf: string[], nonGguf: string[]}> {
    paths.forEach(path => validatePath(path))
    return globalThis.core.api?.getGgufFiles(paths)
  },

  /**
   * Gets the file's stats.
   *
   * @param path - The path to the file.
   */
  fileStat(path: string): Promise<FileStat | undefined> {
    validatePath(path)
    return globalThis.core.api?.fileStat({ args: path })
  },
}
