import { FileStat } from '../types'

const getCoreApi = () => {
  const api = globalThis.core?.api
  if (!api) {
    throw new Error('Core API bridge is not available')
  }
  return api
}

const invalidBridgeResponse = (
  methodName: string,
  expected: string,
  value: unknown
): never => {
  const received = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  throw new Error(
    `Invalid response from core api.${methodName}: expected ${expected}, got ${received}`
  )
}

const validateBridgeResult = async <T>(
  bridgeCallResult: unknown,
  methodName: string,
  validate: (value: unknown, methodName: string) => T
): Promise<T> => {
  const value = await Promise.resolve(bridgeCallResult)
  return validate(value, methodName)
}

const expectVoid = (value: unknown, methodName: string): void => {
  if (value === undefined || value === null) return
  invalidBridgeResponse(methodName, 'void', value)
}

const expectString = (value: unknown, methodName: string): string => {
  if (typeof value === 'string') return value
  return invalidBridgeResponse(methodName, 'string', value)
}

const expectBoolean = (value: unknown, methodName: string): boolean => {
  if (typeof value === 'boolean') return value
  return invalidBridgeResponse(methodName, 'boolean', value)
}

const expectStringArray = (value: unknown, methodName: string): string[] => {
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return value
  }
  return invalidBridgeResponse(methodName, 'string[]', value)
}

const expectGgufFilesResult = (
  value: unknown,
  methodName: string
): { gguf: string[]; nonGguf: string[] } => {
  if (
    value &&
    typeof value === 'object' &&
    'gguf' in value &&
    'nonGguf' in value
  ) {
    const gguf = expectStringArray((value as { gguf: unknown }).gguf, `${methodName}.gguf`)
    const nonGguf = expectStringArray(
      (value as { nonGguf: unknown }).nonGguf,
      `${methodName}.nonGguf`
    )
    return { gguf, nonGguf }
  }
  return invalidBridgeResponse(methodName, '{ gguf: string[]; nonGguf: string[] }', value)
}

const expectFileStat = (
  value: unknown,
  methodName: string
): FileStat | undefined => {
  if (value === undefined || value === null) return undefined
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as FileStat).isDirectory === 'boolean' &&
    typeof (value as FileStat).size === 'number'
  ) {
    return value as FileStat
  }
  return invalidBridgeResponse(methodName, 'FileStat | undefined', value)
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
const SENSITIVE_PATHS = [
  '/etc/passwd', '/etc/shadow', '/etc/sudoers',
  '/private/etc', '/System', '/Library/Preferences',
  'C:\\Windows\\System32', 'C:\\Windows\\System',
]

const validatePath = (path: string): void => {
  if (typeof path !== 'string') {
    throw new Error(`Path must be a string, got ${typeof path}`)
  }

  const normalizedPath = decodePathRecursively(path)

  const normalizedSegments = normalizedPath
    .split(/[/\\]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.')

  if (normalizedSegments.includes('..')) {
    throw new Error(`Path traversal not allowed: ${path}`)
  }

  if (normalizedPath.includes('\0') || /[\x00-\x1F\x7F-\x9F]/.test(normalizedPath)) {
    throw new Error(`Invalid characters in path: ${path}`)
  }

  const lower = normalizedPath.toLowerCase()
  for (const sensitive of SENSITIVE_PATHS) {
    if (lower.startsWith(sensitive.toLowerCase())) {
      throw new Error(`Access denied: ${path}`)
    }
  }
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
    return validateBridgeResult(
      getCoreApi().writeFileSync({ args: [path, data] }),
      'writeFileSync',
      expectVoid
    )
  },

  /**
   * Writes blob data to a file at the specified path.
   * @param path - The path to file.
   * @param data - The blob data.
   */
  writeBlob(path: string, data: string): Promise<void> {
    validatePath(path)
    return validateBridgeResult(getCoreApi().writeBlob(path, data), 'writeBlob', expectVoid)
  },

  /**
   * Reads the contents of a file at the specified path.
   * Historical note: keeps a Sync suffix for API compatibility,
   * but still returns a Promise because the desktop bridge is asynchronous.
   */
  readFileSync(path: string): Promise<string> {
    validatePath(path)
    return validateBridgeResult(
      getCoreApi().readFileSync({ args: [path] }),
      'readFileSync',
      expectString
    )
  },

  /**
   * Check whether the file exists.
   * Historical note: keeps a Sync suffix for API compatibility,
   * but still returns a Promise because the desktop bridge is asynchronous.
   */
  existsSync(path: string): Promise<boolean> {
    validatePath(path)
    return validateBridgeResult(
      getCoreApi().existsSync({ args: [path] }),
      'existsSync',
      expectBoolean
    )
  },

  /**
   * List the directory files.
   * Historical note: keeps a Sync suffix for API compatibility,
   * but still returns a Promise because the desktop bridge is asynchronous.
   */
  readdirSync(path: string): Promise<string[]> {
    validatePath(path)
    return validateBridgeResult(
      getCoreApi().readdirSync({ args: [path] }),
      'readdirSync',
      expectStringArray
    )
  },

  /**
   * Creates a directory at the specified path.
   */
  mkdir(path: string): Promise<void> {
    validatePath(path)
    return validateBridgeResult(getCoreApi().mkdir({ args: [path] }), 'mkdir', expectVoid)
  },

  /**
   * Removes a directory at the specified path.
   */
  rm(path: string): Promise<void> {
    validatePath(path)
    return validateBridgeResult(getCoreApi().rm({ args: [path] }), 'rm', expectVoid)
  },

  /**
   * Moves a file from the source path to the destination path.
   */
  mv(from: string, to: string): Promise<void> {
    validatePath(from)
    validatePath(to)
    return validateBridgeResult(getCoreApi().mv({ args: [from, to] }), 'mv', expectVoid)
  },

  /**
   * Deletes a file from the local file system.
   * @param path - The path of the file to delete.
   */
  unlinkSync(path: string): Promise<void> {
    validatePath(path)
    return validateBridgeResult(
      getCoreApi().unlinkSync({ args: [path] }),
      'unlinkSync',
      expectVoid
    )
  },

  /**
   * Appends data to a file at the specified path.
   */
  appendFileSync(path: string, data: string): Promise<void> {
    validatePath(path)
    return validateBridgeResult(
      getCoreApi().appendFileSync({ args: [path, data] }),
      'appendFileSync',
      expectVoid
    )
  },

  /**
   * Copies a file from the source path to the destination path.
   */
  copyFile(src: string, dest: string): Promise<void> {
    validatePath(src)
    validatePath(dest)
    return validateBridgeResult(getCoreApi().copyFile(src, dest), 'copyFile', expectVoid)
  },

  /**
   * Gets the list of gguf files in a directory.
   *
   * @param paths - The paths to search for gguf files.
   */
  getGgufFiles(paths: string[]): Promise<{ gguf: string[]; nonGguf: string[] }> {
    paths.forEach((path) => validatePath(path))
    return validateBridgeResult(
      getCoreApi().getGgufFiles(paths),
      'getGgufFiles',
      expectGgufFilesResult
    )
  },

  /**
   * Gets the file's stats.
   *
   * @param path - The path to the file.
   */
  fileStat(path: string): Promise<FileStat | undefined> {
    validatePath(path)
    return validateBridgeResult(
      getCoreApi().fileStat({ args: path }),
      'fileStat',
      expectFileStat
    )
  },
}
