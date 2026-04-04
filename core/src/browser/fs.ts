import { FileStat } from '../types'

/**
 * Validates a file path to prevent path traversal attacks.
 * @param path - The path to validate
 * @throws Error if the path contains traversal attempts or invalid characters
 */
const validatePath = (path: string): void => {
  if (typeof path !== 'string') {
    throw new Error(`Path must be a string, got ${typeof path}`)
  }

  // Check for path traversal attempts
  if (path.includes('..') || path.includes('../') || path.includes('..\\')) {
    throw new Error(`Path traversal not allowed: ${path}`)
  }

  // Additional validation: no null bytes, control characters
  if (path.includes('\0') || /[\x00-\x1F\x7F-\x9F]/.test(path)) {
    throw new Error(`Invalid characters in path: ${path}`)
  }

  // Allow absolute paths - the Tauri backend should handle sandboxing
  // Only reject obvious traversal attempts and invalid characters
}

/**
 * Writes data to a file at the specified path.
 * @returns {Promise<void>} A Promise that resolves when the file is written successfully.
 */
const writeFileSync = (...args: any[]): Promise<void> => {
  if (args.length > 0 && typeof args[0] === 'string') {
    validatePath(args[0])
  }
  return globalThis.core.api?.writeFileSync({ args })
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
 * @returns {Promise<string>} A Promise that resolves with the contents of the file.
 */
const readFileSync = (...args: any[]): Promise<string> => {
  if (args.length > 0 && typeof args[0] === 'string') {
    validatePath(args[0])
  }
  return globalThis.core.api?.readFileSync({ args })
}
/**
 * Check whether the file exists
 * @param {string} path
 * @returns {Promise<boolean>} A Promise that resolves with a boolean indicating whether the path exists.
 */
const existsSync = (...args: any[]): Promise<boolean> => {
  if (args.length > 0 && typeof args[0] === 'string') {
    validatePath(args[0])
  }
  return globalThis.core.api?.existsSync({ args })
}
/**
 * List the directory files
 * @returns {Promise<string[]>} A Promise that resolves with an array of filenames in the directory.
 */
const readdirSync = (...args: any[]): Promise<string[]> => {
  if (args.length > 0 && typeof args[0] === 'string') {
    validatePath(args[0])
  }
  return globalThis.core.api?.readdirSync({ args })
}
/**
 * Creates a directory at the specified path.
 * @returns {Promise<void>} A Promise that resolves when the directory is created successfully.
 */
const mkdir = (...args: any[]): Promise<void> => {
  if (args.length > 0 && typeof args[0] === 'string') {
    validatePath(args[0])
  }
  return globalThis.core.api?.mkdir({ args })
}

/**
 * Removes a directory at the specified path.
 * @returns {Promise<void>} A Promise that resolves when the directory is removed successfully.
 */
const rm = (...args: any[]): Promise<void> => {
  if (args.length > 0 && typeof args[0] === 'string') {
    validatePath(args[0])
  }
  return globalThis.core.api?.rm({ args })
}

/**
 * Moves a file from the source path to the destination path.
 * @returns {Promise<void>} A Promise that resolves when the file is moved successfully.
 */
const mv = (...args: any[]): Promise<void> => {
  if (args.length > 0 && typeof args[0] === 'string') {
    validatePath(args[0])
  }
  if (args.length > 1 && typeof args[1] === 'string') {
    validatePath(args[1])
  }
  return globalThis.core.api?.mv({ args })
}

/**
 * Deletes a file from the local file system.
 * @param {string} path - The path of the file to delete.
 * @returns {Promise<void>} A Promise that resolves when the file is deleted.
 */
const unlinkSync = (...args: any[]): Promise<void> => {
  if (args.length > 0 && typeof args[0] === 'string') {
    validatePath(args[0])
  }
  return globalThis.core.api?.unlinkSync(...args)
}

/**
 * Appends data to a file at the specified path.
 * @returns {Promise<void>} A Promise that resolves when the data is appended successfully.
 */
const appendFileSync = (...args: any[]): Promise<void> => {
  if (args.length > 0 && typeof args[0] === 'string') {
    validatePath(args[0])
  }
  return globalThis.core.api?.appendFileSync(...args)
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
