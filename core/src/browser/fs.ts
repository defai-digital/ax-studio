import { FileStat } from '../types'

const getCoreApi = () => {
  const api = globalThis.core?.api
  if (!api) {
    throw new Error('Core API bridge is not available')
  }
  return api
}

const decodePathRecursively = (path: string): string => {
  let decoded = path

  // Loop until `decodeURIComponent` reaches a fixed point (or 16 hops —
  // a generous upper bound to guarantee termination on pathological
  // inputs). The previous 3-iteration cap could theoretically allow a
  // deep URL-encoding chain to slip past the `..` segment detection
  // below; the Tauri backend still sandboxes, but this keeps the
  // defense-in-depth intact.
  for (let i = 0; i < 16; i++) {
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

  const normalizedSegments = normalizedPath
    .split(/[/\\]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.')

  // Check for path traversal attempts via directory navigation segments.
  if (normalizedSegments.includes('..')) {
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
    return getCoreApi().writeFileSync({ args: [path, data] }) as Promise<void>
  },

  /**
   * Writes blob data to a file at the specified path.
   * @param path - The path to file.
   * @param data - The blob data.
   */
  writeBlob(path: string, data: string): Promise<void> {
    validatePath(path)
    return getCoreApi().writeBlob(path, data) as Promise<void>
  },

  /**
   * Reads the contents of a file at the specified path.
   * Historical note: keeps a Sync suffix for API compatibility,
   * but still returns a Promise because the desktop bridge is asynchronous.
   */
  readFileSync(path: string): Promise<string> {
    validatePath(path)
    return getCoreApi().readFileSync({ args: [path] }) as Promise<string>
  },

  /**
   * Check whether the file exists.
   * Historical note: keeps a Sync suffix for API compatibility,
   * but still returns a Promise because the desktop bridge is asynchronous.
   */
  existsSync(path: string): Promise<boolean> {
    validatePath(path)
    return getCoreApi().existsSync({ args: [path] }) as Promise<boolean>
  },

  /**
   * List the directory files.
   * Historical note: keeps a Sync suffix for API compatibility,
   * but still returns a Promise because the desktop bridge is asynchronous.
   */
  readdirSync(path: string): Promise<string[]> {
    validatePath(path)
    return getCoreApi().readdirSync({ args: [path] }) as Promise<string[]>
  },

  /**
   * Creates a directory at the specified path.
   */
  mkdir(path: string): Promise<void> {
    validatePath(path)
    return getCoreApi().mkdir({ args: [path] }) as Promise<void>
  },

  /**
   * Removes a directory at the specified path.
   */
  rm(path: string): Promise<void> {
    validatePath(path)
    return getCoreApi().rm({ args: [path] }) as Promise<void>
  },

  /**
   * Moves a file from the source path to the destination path.
   */
  mv(from: string, to: string): Promise<void> {
    validatePath(from)
    validatePath(to)
    return getCoreApi().mv({ args: [from, to] }) as Promise<void>
  },

  /**
   * Deletes a file from the local file system.
   * @param path - The path of the file to delete.
   */
  unlinkSync(path: string): Promise<void> {
    validatePath(path)
    return getCoreApi().unlinkSync({ args: [path] }) as Promise<void>
  },

  /**
   * Appends data to a file at the specified path.
   */
  appendFileSync(path: string, data: string): Promise<void> {
    validatePath(path)
    return getCoreApi().appendFileSync({ args: [path, data] }) as Promise<void>
  },

  /**
   * Copies a file from the source path to the destination path.
   */
  copyFile(src: string, dest: string): Promise<void> {
    validatePath(src)
    validatePath(dest)
    return getCoreApi().copyFile(src, dest) as Promise<void>
  },

  /**
   * Gets the list of gguf files in a directory.
   *
   * @param paths - The paths to search for gguf files.
   */
  getGgufFiles(paths: string[]): Promise<{ gguf: string[]; nonGguf: string[] }> {
    paths.forEach((path) => validatePath(path))
    return getCoreApi().getGgufFiles(paths) as Promise<{
      gguf: string[]
      nonGguf: string[]
    }>
  },

  /**
   * Gets the file's stats.
   *
   * @param path - The path to the file.
   */
  fileStat(path: string): Promise<FileStat | undefined> {
    validatePath(path)
    return getCoreApi().fileStat({ args: path }) as Promise<FileStat | undefined>
  },
}
