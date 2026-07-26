// Path validation helpers — port of
// src-tauri/plugins/tauri-plugin-llamacpp/src/path.rs plus the trusted-root
// registration from src-tauri/src/core/setup.rs (`app_setup`).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { getAppDataFolderPath } from '../state.js'
import { LlamacppError } from './error.js'

/**
 * Trusted install roots for inference binaries. Computed on every call (the
 * data folder can change at runtime via `change_app_data_folder`). Mirrors
 * `app_setup` in src-tauri/src/core/setup.rs.
 */
export function trustedBinaryRoots(): string[] {
  const dataFolder = getAppDataFolderPath()
  const roots = [
    path.join(dataFolder, 'llamacpp', 'backends'),
    path.join(dataFolder, 'ax-serving'),
  ]
  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles
    if (programFiles) roots.push(programFiles)
  } else {
    roots.push('/usr/local/bin', '/opt/homebrew/bin', '/usr/bin')
  }
  return roots
}

/** Trusted roots for model/mmproj files (`app_setup`). */
export function trustedModelRoots(): string[] {
  return [path.join(getAppDataFolderPath(), 'llamacpp', 'models')]
}

/** Port of `is_dangerous_process_env_key` (case-insensitive). */
export function isDangerousProcessEnvKey(key: string): boolean {
  const upper = key.toUpperCase()
  return (
    [
      'PATH',
      'PATHEXT',
      'LD_PRELOAD',
      'LD_LIBRARY_PATH',
      'PYTHONHOME',
      'PYTHONPATH',
      'NODE_OPTIONS',
      'RUBYOPT',
      'PERL5OPT',
      'BASH_ENV',
      'ENV',
      'GCONV_PATH',
      'AX_ENGINE_BIN',
    ].includes(upper) || upper.startsWith('DYLD_')
  )
}

function canonicalizeOrSelf(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return p
  }
}

/** Port of `validate_path_within_roots`. Returns the canonicalized path. */
export function validatePathWithinRoots(
  target: string,
  trustedRoots: string[],
  label: string,
): string {
  let canonical: string
  try {
    canonical = fs.realpathSync(target)
  } catch (error) {
    throw new LlamacppError(
      'MODEL_FILE_NOT_FOUND',
      `The specified ${label} path could not be resolved safely.`,
      String(error),
    )
  }
  const allowed = trustedRoots.some((root) => {
    const normalizedRoot = canonicalizeOrSelf(root)
    return canonical === normalizedRoot || canonical.startsWith(normalizedRoot + path.sep)
  })
  if (!allowed) {
    throw new LlamacppError(
      'INVALID_ARGUMENT',
      `The ${label} path is outside AX Studio's managed model directories.`,
      canonical,
    )
  }
  return canonical
}

function commandHasPathSeparator(command: string): boolean {
  return command.includes('/') || command.includes('\\')
}

function executableCandidates(binaryName: string): string[] {
  if (process.platform !== 'win32') return [binaryName]
  if (path.extname(binaryName)) return [binaryName]
  const pathext = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD'
  return [
    ...pathext
      .split(';')
      .filter((ext) => ext.length > 0)
      .map((ext) => `${binaryName}${ext}`),
    binaryName,
  ]
}

function findBinaryOnPath(binaryName: string): string | null {
  const pathEnv = process.env.PATH
  if (!pathEnv) return null
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue
    for (const candidate of executableCandidates(binaryName)) {
      const fullPath = path.join(dir, candidate)
      if (fs.existsSync(fullPath)) return fullPath
    }
  }
  return null
}

function resolveBinaryPath(backendPath: string): string | null {
  if (fs.existsSync(backendPath)) return backendPath
  if (!commandHasPathSeparator(backendPath)) return findBinaryOnPath(backendPath)
  return null
}

/**
 * Port of `validate_binary_path`: binary must exist, be a file, carry an
 * allowed executable name, and resolve beneath a trusted install root. On
 * macOS, strips quarantine attributes for binaries inside user directories.
 */
export function validateBinaryPath(
  backendPath: string,
  trustedRoots: string[],
  allowedNames: string[],
): string {
  const resolved = resolveBinaryPath(backendPath)
  if (!resolved) {
    throw new LlamacppError(
      'BINARY_NOT_FOUND',
      'The inference backend binary could not be found. Install a llama.cpp backend or provide a valid backend binary path.',
      `Binary not found at ${JSON.stringify(backendPath)}`,
    )
  }

  let canonical: string
  try {
    canonical = fs.realpathSync(resolved)
  } catch (error) {
    throw new LlamacppError(
      'BINARY_NOT_FOUND',
      'The inference backend binary could not be resolved safely.',
      String(error),
    )
  }
  if (!fs.statSync(canonical).isFile()) {
    throw new LlamacppError(
      'BINARY_NOT_FOUND',
      'The inference backend path is not a file.',
      canonical,
    )
  }

  const binaryName = path.basename(canonical).toLowerCase()
  if (!allowedNames.some((allowed) => binaryName === allowed.toLowerCase())) {
    throw new LlamacppError(
      'INVALID_ARGUMENT',
      'The inference backend executable name is not allowed.',
      binaryName,
    )
  }

  const withinTrustedRoot = trustedRoots.some((root) => {
    const normalizedRoot = canonicalizeOrSelf(root)
    return canonical === normalizedRoot || canonical.startsWith(normalizedRoot + path.sep)
  })
  if (!withinTrustedRoot) {
    throw new LlamacppError(
      'INVALID_ARGUMENT',
      "The inference backend is outside AX Studio's trusted install directories.",
      canonical,
    )
  }

  if (process.platform === 'darwin') {
    const isInUserDir =
      canonical.includes('/.ax-studio/') ||
      canonical.includes('/Library/Application Support/') ||
      canonical.includes('/.local/share/')
    if (isInUserDir) {
      try {
        execFileSync('xattr', ['-cr', canonical], { stdio: 'ignore' })
      } catch (error) {
        console.warn(`[llamacpp] xattr -cr on ${canonical} failed:`, error)
      }
    }
  }

  return canonical
}

function pathArg(
  args: string[],
  flag: string,
  missingValueMessage: string,
): { index: number; path: string } | null {
  const flagIndex = args.indexOf(flag)
  if (flagIndex === -1) return null
  const value = args[flagIndex + 1]
  if (value === undefined) {
    throw new LlamacppError('MODEL_LOAD_FAILED', missingValueMessage)
  }
  return { index: flagIndex, path: value }
}

function validateExistingFile(target: string, label: string, userMessage: string): void {
  if (!fs.existsSync(target)) {
    throw new LlamacppError(
      'MODEL_FILE_NOT_FOUND',
      userMessage,
      `Invalid or inaccessible ${label} path: ${target}`,
    )
  }
}

/** Port of `validate_model_path`: validates the `-m` arg in place. */
export function validateModelPath(args: string[]): string {
  const found = pathArg(args, '-m', "Model path was not provided after '-m' flag.")
  if (!found) {
    throw new LlamacppError('MODEL_LOAD_FAILED', "Model path argument '-m' is missing.")
  }
  validateExistingFile(
    found.path,
    'model',
    'The specified model file does not exist or is not accessible.',
  )
  // Rust rewrites the arg with the (possibly Windows-shortened) path; POSIX is identity.
  args[found.index + 1] = found.path
  return found.path
}

/** Port of `validate_mmproj_path`: validates the optional `--mmproj` arg. */
export function validateMmprojPath(args: string[]): string | null {
  const found = pathArg(args, '--mmproj', "Mmproj path was not provided after '--mmproj' flag.")
  if (!found) return null
  validateExistingFile(
    found.path,
    'mmproj',
    'The specified mmproj file does not exist or is not accessible.',
  )
  args[found.index + 1] = found.path
  return found.path
}
