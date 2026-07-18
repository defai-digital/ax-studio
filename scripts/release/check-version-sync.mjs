/**
 * Verify that every app-version manifest shares one semantic version.
 *
 * Local `yarn dev` reads web-app/package.json (UI) and tauri.conf.json
 * (native). Release CI also rewrites these via set-version.mjs. When the
 * committed tree drifts (e.g. tags at v2.1.0 while tauri.conf is 1.3.24),
 * developers see the wrong version. This check keeps the sources in lockstep.
 *
 * Usage:
 *   node scripts/release/check-version-sync.mjs
 *   node scripts/release/check-version-sync.mjs --expect 2.1.0
 */

import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  cargoFiles,
  packageJsonFiles,
  tauriConfigPath,
} from './set-version.mjs'

const defaultRepoRoot = path.resolve(import.meta.dirname, '..', '..')

export class VersionSyncError extends Error {}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readFile(repoRoot, relativePath) {
  const fullPath = path.join(repoRoot, relativePath)
  try {
    return fs.readFileSync(fullPath, 'utf8')
  } catch (error) {
    throw new VersionSyncError(`cannot read ${relativePath}: ${error.message}`, {
      cause: error,
    })
  }
}

function readJsonVersion(repoRoot, relativePath) {
  const source = readFile(repoRoot, relativePath)
  let value
  try {
    value = JSON.parse(source)
  } catch (error) {
    throw new VersionSyncError(`${relativePath} is not valid JSON: ${error.message}`, {
      cause: error,
    })
  }
  if (!isRecord(value) || typeof value.version !== 'string') {
    throw new VersionSyncError(`${relativePath} must contain a string version field`)
  }
  return value.version
}

function readCargoPackageVersion(repoRoot, relativePath) {
  const source = readFile(repoRoot, relativePath)
  const packageHeader = /^\[package\]\s*$/m.exec(source)
  if (!packageHeader) {
    throw new VersionSyncError(`${relativePath} must contain a [package] section`)
  }

  const sectionStart = packageHeader.index + packageHeader[0].length
  const remainder = source.slice(sectionStart)
  const nextSectionOffset = /^\[[^\]]+\]\s*$/m.exec(remainder)?.index ?? remainder.length
  const packageSection = source.slice(sectionStart, sectionStart + nextSectionOffset)
  const matches = [...packageSection.matchAll(/^version\s*=\s*"([^"]*)"/gm)]

  if (matches.length !== 1) {
    throw new VersionSyncError(
      `${relativePath} [package] must contain exactly one quoted version field, found ${matches.length}`,
    )
  }

  return matches[0][1]
}

/**
 * Collect app versions from every manifest set-version touches.
 * @returns {{ version: string, entries: Array<{ relativePath: string, version: string }> }}
 */
export function collectAppVersions(repoRoot = defaultRepoRoot) {
  const entries = [
    { relativePath: tauriConfigPath, version: readJsonVersion(repoRoot, tauriConfigPath) },
    ...packageJsonFiles.map((relativePath) => ({
      relativePath,
      version: readJsonVersion(repoRoot, relativePath),
    })),
    ...cargoFiles.map((relativePath) => ({
      relativePath,
      version: readCargoPackageVersion(repoRoot, relativePath),
    })),
  ]

  const versions = new Set(entries.map((entry) => entry.version))
  if (versions.size !== 1) {
    const detail = entries
      .map((entry) => `  ${entry.relativePath}: ${entry.version}`)
      .join('\n')
    throw new VersionSyncError(
      `app version manifests are out of sync:\n${detail}\n` +
        `Run: node scripts/release/set-version.mjs --version <semver>`,
    )
  }

  const version = entries[0].version
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new VersionSyncError(
      `app version must be a semantic version (e.g. 2.1.0), got: ${version}`,
    )
  }

  return { version, entries }
}

export function parseCliArguments(argv) {
  let expect
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    // Yarn/npm often forward a bare `--` separator; ignore it.
    if (token === '--') continue
    if (token === '--expect') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new VersionSyncError('missing value for argument: --expect')
      }
      if (!/^\d+\.\d+\.\d+$/.test(value)) {
        throw new VersionSyncError(
          `expected version must be a semantic version (e.g. 2.1.0), got: ${value}`,
        )
      }
      expect = value
      index += 1
      continue
    }
    throw new VersionSyncError(`unknown argument: ${token}`)
  }
  return { expect }
}

export function checkVersionSync(repoRoot = defaultRepoRoot, { expect } = {}) {
  const { version, entries } = collectAppVersions(repoRoot)
  if (expect !== undefined && version !== expect) {
    throw new VersionSyncError(
      `app version is ${version}, expected ${expect}\n` +
        `Run: node scripts/release/set-version.mjs --version ${expect}`,
    )
  }
  return { version, entries }
}

function main() {
  try {
    const options = parseCliArguments(process.argv.slice(2))
    const { version, entries } = checkVersionSync(defaultRepoRoot, options)
    for (const entry of entries) {
      console.log(`  ${entry.relativePath}: ${entry.version}`)
    }
    console.log(`check-version-sync ok: ${version}`)
  } catch (error) {
    console.error(`check-version-sync error: ${error.message}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
