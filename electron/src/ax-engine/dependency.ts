// ax-engine binary resolution + version floor, mirroring AX Code's
// dependency.ts: config override → AX_ENGINE_BIN env → PATH (plus macOS
// Homebrew directories when Finder omits them) → managed install
// dir, with a >= 6.9.0 version check via `ax-engine --version`
// (falling back to `ax-engine doctor --json`, since released ax-engine builds
// implement no --version flag).
//
// TODO(phase-3): managed auto-download. The current GitHub release tarball is
// not self-contained (missing MLX dylibs/metallib); the next ax-engine release
// will ship a self-contained artifact (see
// docs/architecture/electron-migration-phase0-matrix.md §5). Until then the
// managed slot is install-it-yourself and absence surfaces as
// `missing_dependency` with install guidance.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { managedBinaryPath } from './paths.js'
import type { AxEngineBinarySource } from './types.js'
import { findSystemExecutable, isExecutable } from '../executable-search.js'

const execFileAsync = promisify(execFile)

export const MIN_AX_ENGINE_VERSION = '6.9.0'

export interface ResolvedAxEngineBinary {
  path: string
  source: AxEngineBinarySource
}

export interface AxEngineDependency {
  binary: ResolvedAxEngineBinary | null
  version: string | null
  versionOk: boolean
  detail?: string
}

/**
 * Resolution order (AX Code parity): explicit override (e.g. from settings) →
 * `AX_ENGINE_BIN` env (dev escape hatch) → `ax-engine` on PATH / macOS Homebrew → managed
 * install dir. A configured override/env that is not executable is a hard
 * miss (never silently falls through); PATH and managed are best-effort.
 */
export function resolveAxEngineBinary(override?: string): ResolvedAxEngineBinary | null {
  if (override) return isExecutable(override) ? { path: override, source: 'override' } : null
  const envBin = process.env.AX_ENGINE_BIN
  if (envBin) return isExecutable(envBin) ? { path: envBin, source: 'env' } : null
  const onPath = findSystemExecutable('ax-engine')
  if (onPath) return { path: onPath, source: 'path' }
  const managed = managedBinaryPath()
  if (isExecutable(managed)) return { path: managed, source: 'managed' }
  return null
}

export function parseAxEngineVersion(output: string): string | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(output)
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

async function runAxEngineProbe(
  binaryPath: string,
  args: string[]
): Promise<{ stdout: string; stderr: string } | null> {
  try {
    const { stdout, stderr } = await execFileAsync(binaryPath, args, {
      timeout: 10_000,
      env: { ...process.env },
    })
    return { stdout, stderr }
  } catch {
    return null
  }
}

/** Extract `install.version` from `ax-engine doctor --json`; null when absent. */
export function parseAxEngineDoctorVersion(output: string): string | null {
  try {
    const install = (JSON.parse(output) as { install?: { version?: unknown } })
      .install
    return typeof install?.version === 'string'
      ? parseAxEngineVersion(install.version)
      : null
  } catch {
    return null
  }
}

/**
 * Resolve the engine's semver. Released ax-engine builds (including the
 * Developer ID signed Homebrew v7.3.1) implement no `--version` flag and reply
 * "unknown command", so fall back to `doctor --json` -> `install.version`.
 * Without this the >= 6.9.0 gate rejects a valid engine and the sidecar never
 * starts.
 */
export async function queryAxEngineVersion(binaryPath: string): Promise<string | null> {
  const versionProbe = await runAxEngineProbe(binaryPath, ['--version'])
  const direct = versionProbe
    ? parseAxEngineVersion(`${versionProbe.stdout}\n${versionProbe.stderr}`)
    : null
  if (direct) return direct
  const doctorProbe = await runAxEngineProbe(binaryPath, ['doctor', '--json'])
  return doctorProbe ? parseAxEngineDoctorVersion(doctorProbe.stdout) : null
}

export const MISSING_BINARY_DETAIL =
  'ax-engine binary not found. Install it (e.g. `brew install defai-digital/tap/ax-engine` or place it on PATH / set AX_ENGINE_BIN), ' +
  'or drop a self-contained build at <data>/ax-engine/ax-engine. Managed auto-download lands once ax-engine ships ' +
  'a self-contained release artifact (see electron-migration-phase0-matrix.md §5).'

/**
 * Resolve the binary and enforce the >= 6.9.0 floor. A binary that fails the
 * floor is reported as a dependency gap, never spawned.
 */
export async function checkAxEngineDependency(override?: string): Promise<AxEngineDependency> {
  const binary = resolveAxEngineBinary(override)
  if (!binary) {
    const detail = override
      ? `Configured ax-engine binary is not executable: ${override}`
      : MISSING_BINARY_DETAIL
    return { binary: null, version: null, versionOk: false, detail }
  }
  const version = await queryAxEngineVersion(binary.path)
  if (!version) {
    return {
      binary,
      version: null,
      versionOk: false,
      detail: `Could not determine ax-engine version from \`${binary.path}\` (--version / doctor --json); need >= ${MIN_AX_ENGINE_VERSION}.`,
    }
  }
  if (compareVersions(version, MIN_AX_ENGINE_VERSION) < 0) {
    return {
      binary,
      version,
      versionOk: false,
      detail: `ax-engine ${version} at ${binary.path} is below the required floor ${MIN_AX_ENGINE_VERSION}.`,
    }
  }
  return { binary, version, versionOk: true }
}
