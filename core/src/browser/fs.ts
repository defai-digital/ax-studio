import { FileStat } from '../types'
import { getCoreApi } from './core'

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
  let lastStable = decoded
  for (let i = 0; i < 32; i++) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      lastStable = decoded
      decoded = next
    } catch {
      break
    }
  }
  if (decoded !== lastStable && decodeURIComponent(decoded) !== decoded) {
    decoded = lastStable
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

const validatePath = (path: string): string => {
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

  return normalizedPath
}

/**
 * Browser fs module — thin validated wrappers around the Tauri desktop bridge.
 *
 * Every public method lives directly on this object, so adding a new function
 * automatically makes it available to consumers (no separate export list needed).
 */
export const fs = {
  writeFileSync(path: string, data: string): Promise<void> {
    const safePath = validatePath(path)
    return validateBridgeResult(
      getCoreApi().writeFileSync({ args: [safePath, data] }),
      'writeFileSync',
      expectVoid
    )
  },

  writeBlob(path: string, data: string): Promise<void> {
    const safePath = validatePath(path)
    return validateBridgeResult(getCoreApi().writeBlob(safePath, data), 'writeBlob', expectVoid)
  },

  readFileSync(path: string): Promise<string> {
    const safePath = validatePath(path)
    return validateBridgeResult(
      getCoreApi().readFileSync({ args: [safePath] }),
      'readFileSync',
      expectString
    )
  },

  existsSync(path: string): Promise<boolean> {
    const safePath = validatePath(path)
    return validateBridgeResult(
      getCoreApi().existsSync({ args: [safePath] }),
      'existsSync',
      expectBoolean
    )
  },

  readdirSync(path: string): Promise<string[]> {
    const safePath = validatePath(path)
    return validateBridgeResult(
      getCoreApi().readdirSync({ args: [safePath] }),
      'readdirSync',
      expectStringArray
    )
  },

  mkdir(path: string): Promise<void> {
    const safePath = validatePath(path)
    return validateBridgeResult(getCoreApi().mkdir({ args: [safePath] }), 'mkdir', expectVoid)
  },

  rm(path: string): Promise<void> {
    const safePath = validatePath(path)
    return validateBridgeResult(getCoreApi().rm({ args: [safePath] }), 'rm', expectVoid)
  },

  mv(from: string, to: string): Promise<void> {
    const safeFrom = validatePath(from)
    const safeTo = validatePath(to)
    return validateBridgeResult(getCoreApi().mv({ args: [safeFrom, safeTo] }), 'mv', expectVoid)
  },

  unlinkSync(path: string): Promise<void> {
    const safePath = validatePath(path)
    return validateBridgeResult(
      getCoreApi().unlinkSync({ args: [safePath] }),
      'unlinkSync',
      expectVoid
    )
  },

  appendFileSync(path: string, data: string): Promise<void> {
    const safePath = validatePath(path)
    return validateBridgeResult(
      getCoreApi().appendFileSync({ args: [safePath, data] }),
      'appendFileSync',
      expectVoid
    )
  },

  copyFile(src: string, dest: string): Promise<void> {
    const safeSrc = validatePath(src)
    const safeDest = validatePath(dest)
    return validateBridgeResult(getCoreApi().copyFile(safeSrc, safeDest), 'copyFile', expectVoid)
  },

  getGgufFiles(paths: string[]): Promise<{ gguf: string[]; nonGguf: string[] }> {
    const safePaths = paths.map((p) => validatePath(p))
    return validateBridgeResult(
      getCoreApi().getGgufFiles(safePaths),
      'getGgufFiles',
      expectGgufFilesResult
    )
  },

  fileStat(path: string): Promise<FileStat | undefined> {
    const safePath = validatePath(path)
    return validateBridgeResult(
      getCoreApi().fileStat({ args: safePath }),
      'fileStat',
      expectFileStat
    )
  },
}
