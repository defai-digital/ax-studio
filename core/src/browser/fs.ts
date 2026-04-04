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
 * Writes data to a file at the specified path.
 * Historical note: these methods keep a Sync suffix for API compatibility,
 * but they still return Promises because the desktop bridge is asynchronous.
 * @returns {Promise<void>} A Promise that resolves when the file is written successfully.
 */
const writeFileSync = (path: string, data: string): Promise<void> => {
  validatePath(path)
  return globalThis.core.api?.writeFileSync({ args: [path, data] })
}

/**
 * Writes blob data to a file at the specified path.
 * @param path - The path to file.
 * @param data - The blob data.
 * @returns {Promise<void>} A Promise that resolves when the blob is written successfully.
 */
const writeBlob: (path: string, data: string) => Promise<void> = (path, data) => {
  validatePath(path)
  return globalThis.core.api?.writeBlob(path, data)
}

/**
 * Reads the contents of a file at the specified path.
 * Historical note: this method keeps a Sync suffix for API compatibility,
 * but it still returns a Promise because the desktop bridge is asynchronous.
 * @returns {Promise<string>} A Promise that resolves with the contents of the file.
 */
const readFileSync = (path: string): Promise<string> => {
  validatePath(path)
  return globalThis.core.api?.readFileSync({ args: [path] })
}
/**
 * Check whether the file exists
 * Historical note: this method keeps a Sync suffix for API compatibility,
 * but it still returns a Promise because the desktop bridge is asynchronous.
 * @param {string} path
 * @returns {Promise<boolean>} A Promise that resolves with a boolean indicating whether the path exists.
 */
const existsSync = (path: string): Promise<boolean> => {
  validatePath(path)
  return globalThis.core.api?.existsSync({ args: [path] })
}
/**
 * List the directory files
 * Historical note: this method keeps a Sync suffix for API compatibility,
 * but it still returns a Promise because the desktop bridge is asynchronous.
 * @returns {Promise<string[]>} A Promise that resolves with an array of filenames in the directory.
 */
const readdirSync = (path: string): Promise<string[]> => {
  validatePath(path)
  return globalThis.core.api?.readdirSync({ args: [path] })
}
/**
 * Creates a directory at the specified path.
 * @returns {Promise<void>} A Promise that resolves when the directory is created successfully.
 */
const mkdir = (path: string): Promise<void> => {
  validatePath(path)
  return globalThis.core.api?.mkdir({ args: [path] })
}

/**
 * Removes a directory at the specified path.
 * @returns {Promise<void>} A Promise that resolves when the directory is removed successfully.
 */
const rm = (path: string): Promise<void> => {
  validatePath(path)
  return globalThis.core.api?.rm({ args: [path] })
}

/**
 * Moves a file from the source path to the destination path.
 * @returns {Promise<void>} A Promise that resolves when the file is moved successfully.
 */
const mv = (from: string, to: string): Promise<void> => {
  validatePath(from)
  validatePath(to)
  return globalThis.core.api?.mv({ args: [from, to] })
}

/**
 * Deletes a file from the local file system.
 * @param {string} path - The path of the file to delete.
 * @returns {Promise<void>} A Promise that resolves when the file is deleted.
 */
const unlinkSync = (path: string): Promise<void> => {
  validatePath(path)
  return globalThis.core.api?.unlinkSync({ args: [path] })
}

/**
 * Appends data to a file at the specified path.
 * @returns {Promise<void>} A Promise that resolves when the data is appended successfully.
 */
const appendFileSync = (path: string, data: string): Promise<void> => {
  validatePath(path)
  return globalThis.core.api?.appendFileSync({ args: [path, data] })
}

/**
 * Copies a file from the source path to the destination path.
 * @param src
 * @param dest
 * @returns
 */
const copyFile: (src: string, dest: string) => Promise<void> = (src, dest) => {
  validatePath(src)
  validatePath(dest)
  return globalThis.core.api?.copyFile(src, dest)
}

/**
 * Gets the list of gguf files in a directory
 *
 * @param paths - The paths to search for gguf files.
 * @returns {Promise<{gguf: string[], nonGguf: string[]}>} - A promise that resolves with the list of gguf and non-gguf files
 */
const getGgufFiles: (paths: string[]) => Promise<{gguf: string[], nonGguf: string[]}> = (paths) => {
  paths.forEach(path => validatePath(path))
  return globalThis.core.api?.getGgufFiles(paths)
}

/**
 * Gets the file's stats.
 *
 * @param path - The path to the file.
 * @param outsideAppDataFolder - Whether the file is outside the app data folder.
 * @returns {Promise<FileStat>} - A promise that resolves with the file's stats.
 */
const fileStat: (path: string) => Promise<FileStat | undefined> = (path) => {
  validatePath(path)
  return globalThis.core.api?.fileStat({ args: path })
}

// TODO: Export `dummy` fs functions automatically
// Currently adding these manually
export const fs = {
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  mkdir,
  rm,
  mv,
  unlinkSync,
  appendFileSync,
  copyFile,
  fileStat,
  writeBlob,
  getGgufFiles,
}
