#!/usr/bin/env node

/**
 * Centralized version-bumping script for AX Studio.
 *
 * Updates version strings across tauri.conf.json, Cargo.toml files,
 * package.json files, and optionally configures updater artifacts and
 * Windows code-signing — replacing duplicated shell blocks in CI.
 *
 * All inputs and target files are validated before any file is changed. Each
 * write is staged beside its destination and atomically renamed into place so
 * a terminated release job cannot leave a truncated manifest behind.
 *
 * Usage:
 *   node scripts/release/set-version.mjs --version <version> [options]
 *
 * Options:
 *   --version <ver>          Required. Semantic version (e.g. 1.3.3)
 *   --channel <name>         Release channel: stable | beta | nightly (default: stable)
 *   --updater-pubkey <key>   Enables createUpdaterArtifacts and sets the pubkey
 *   --windows-sign-command   Adds signCommand to tauri.windows.conf.json
 */

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const defaultRepoRoot = path.resolve(import.meta.dirname, '..', '..')
const valueArguments = new Set(['version', 'channel', 'updater-pubkey'])
const booleanArguments = new Set(['windows-sign-command'])
const releaseChannels = new Set(['stable', 'beta', 'nightly'])
export const WINDOWS_SIGN_COMMAND = 'powershell -ExecutionPolicy Bypass -File ./sign.ps1 %1'

const packageJsonFiles = [
  'web-app/package.json',
  'src-tauri/plugins/tauri-plugin-hardware/package.json',
  'src-tauri/plugins/tauri-plugin-llamacpp/package.json',
]

const cargoFiles = [
  'src-tauri/Cargo.toml',
  'src-tauri/plugins/tauri-plugin-hardware/Cargo.toml',
  'src-tauri/plugins/tauri-plugin-llamacpp/Cargo.toml',
]

export class CliUsageError extends Error {}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireRecord(value, description) {
  if (!isRecord(value)) {
    throw new Error(`${description} must be a JSON object`)
  }
  return value
}

export function parseCliArguments(argv) {
  const values = new Map()
  const flags = new Set()

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]

    if (!token.startsWith('--') || token === '--') {
      throw new CliUsageError(`unexpected positional argument: ${token}`)
    }

    const name = token.slice(2)
    if (booleanArguments.has(name)) {
      if (flags.has(name)) {
        throw new CliUsageError(`duplicate argument: --${name}`)
      }
      flags.add(name)
      continue
    }

    if (!valueArguments.has(name)) {
      throw new CliUsageError(`unknown argument: --${name}`)
    }
    if (values.has(name)) {
      throw new CliUsageError(`duplicate argument: --${name}`)
    }

    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new CliUsageError(`missing value for argument: --${name}`)
    }
    values.set(name, value)
    index += 1
  }

  const version = values.get('version')
  if (!version) {
    throw new CliUsageError('missing required argument: --version')
  }
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new CliUsageError(
      `version must be a semantic version (e.g. 1.3.3), got: ${version}`,
    )
  }

  const channel = values.get('channel') ?? 'stable'
  if (!releaseChannels.has(channel)) {
    throw new CliUsageError(
      `channel must be one of ${[...releaseChannels].join(', ')}, got: ${channel}`,
    )
  }

  const updaterPubkey = values.get('updater-pubkey') ?? ''
  if (values.has('updater-pubkey') && updaterPubkey.trim() === '') {
    throw new CliUsageError('--updater-pubkey must not be empty')
  }

  return {
    version,
    channel,
    updaterPubkey,
    windowsSignCommand: flags.has('windows-sign-command'),
  }
}

function readFile(repoRoot, relativePath) {
  const fullPath = path.join(repoRoot, relativePath)
  try {
    return fs.readFileSync(fullPath, 'utf8')
  } catch (error) {
    throw new Error(`cannot read ${relativePath}: ${error.message}`, { cause: error })
  }
}

function readJson(repoRoot, relativePath) {
  const source = readFile(repoRoot, relativePath)
  try {
    return { source, value: JSON.parse(source) }
  } catch (error) {
    throw new Error(`${relativePath} is not valid JSON: ${error.message}`, { cause: error })
  }
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

function updatePackageJsonVersion(repoRoot, relativePath, version) {
  const { source, value } = readJson(repoRoot, relativePath)
  const packageJson = requireRecord(value, relativePath)
  if (typeof packageJson.version !== 'string') {
    throw new Error(`${relativePath} must contain a string version field`)
  }

  return {
    relativePath,
    originalContent: source,
    content: serializeJson({ ...packageJson, version }),
  }
}

function patchCargoPackageStringField(source, field, value, relativePath) {
  const packageHeader = /^\[package\]\s*$/m.exec(source)
  if (!packageHeader) {
    throw new Error(`${relativePath} must contain a [package] section`)
  }

  const sectionStart = packageHeader.index + packageHeader[0].length
  const remainder = source.slice(sectionStart)
  const nextSectionOffset = /^\[[^\]]+\]\s*$/m.exec(remainder)?.index ?? remainder.length
  const sectionEnd = sectionStart + nextSectionOffset
  const packageSection = source.slice(sectionStart, sectionEnd)
  const fieldPattern = new RegExp(`^(${field}\\s*=\\s*)"[^"]*"`, 'gm')
  const matches = [...packageSection.matchAll(fieldPattern)]

  if (matches.length !== 1) {
    throw new Error(
      `${relativePath} [package] must contain exactly one quoted ${field} field, found ${matches.length}`,
    )
  }

  const updatedSection = packageSection.replace(fieldPattern, `$1"${value}"`)
  return `${source.slice(0, sectionStart)}${updatedSection}${source.slice(sectionEnd)}`
}

export function patchCargoPackageVersion(source, version, relativePath = 'Cargo.toml') {
  return patchCargoPackageStringField(source, 'version', version, relativePath)
}

/**
 * Read and validate every release manifest, returning an in-memory change set.
 * Keeping this phase side-effect free prevents a late malformed file from
 * leaving earlier manifests on a different version.
 */
export function prepareVersionChanges(repoRoot, options) {
  const { version, channel, updaterPubkey, windowsSignCommand } = options
  const changes = []

  const tauriPath = 'src-tauri/tauri.conf.json'
  const { source: tauriSource, value: tauriValue } = readJson(repoRoot, tauriPath)
  const tauriConfig = requireRecord(tauriValue, tauriPath)
  const bundle = requireRecord(tauriConfig.bundle, `${tauriPath} bundle`)
  const updatedTauriConfig = {
    ...tauriConfig,
    version,
    bundle: {
      ...bundle,
      createUpdaterArtifacts: Boolean(updaterPubkey),
    },
  }

  if (updaterPubkey) {
    const plugins = requireRecord(tauriConfig.plugins, `${tauriPath} plugins`)
    const updater = requireRecord(plugins.updater, `${tauriPath} plugins.updater`)
    updatedTauriConfig.plugins = {
      ...plugins,
      updater: { ...updater, pubkey: updaterPubkey },
    }
  }

  changes.push({
    relativePath: tauriPath,
    originalContent: tauriSource,
    content: serializeJson(updatedTauriConfig),
  })

  for (const relativePath of packageJsonFiles) {
    changes.push(updatePackageJsonVersion(repoRoot, relativePath, version))
  }

  for (const relativePath of cargoFiles) {
    const originalContent = readFile(repoRoot, relativePath)
    let content = patchCargoPackageVersion(originalContent, version, relativePath)
    if (relativePath === 'src-tauri/Cargo.toml') {
      const packageName = channel === 'stable' ? 'ax-studio' : `ax-studio-${channel}`
      content = patchCargoPackageStringField(content, 'name', packageName, relativePath)
    }
    changes.push({
      relativePath,
      originalContent,
      content,
    })
  }

  if (windowsSignCommand) {
    const windowsPath = 'src-tauri/tauri.windows.conf.json'
    const { source, value } = readJson(repoRoot, windowsPath)
    const windowsConfig = requireRecord(value, windowsPath)
    const windowsBundle = windowsConfig.bundle === undefined
      ? {}
      : requireRecord(windowsConfig.bundle, `${windowsPath} bundle`)
    const windows = windowsBundle.windows === undefined
      ? {}
      : requireRecord(windowsBundle.windows, `${windowsPath} bundle.windows`)

    changes.push({
      relativePath: windowsPath,
      originalContent: source,
      content: serializeJson({
        ...windowsConfig,
        bundle: {
          ...windowsBundle,
          windows: {
            ...windows,
            signCommand: WINDOWS_SIGN_COMMAND,
          },
        },
      }),
    })
  }

  return changes
}

export function writeVersionChanges(repoRoot, changes) {
  const stagedFiles = []

  try {
    for (const change of changes) {
      const fullPath = path.join(repoRoot, change.relativePath)
      const stats = fs.statSync(fullPath)
      const temporaryPath = `${fullPath}.${process.pid}.${randomUUID()}.tmp`
      fs.writeFileSync(temporaryPath, change.content, { mode: stats.mode })
      stagedFiles.push({ ...change, fullPath, temporaryPath })
    }

    for (const stagedFile of stagedFiles) {
      fs.renameSync(stagedFile.temporaryPath, stagedFile.fullPath)
    }
  } catch (error) {
    // A failure while staging leaves every destination untouched. If a rename
    // fails partway through, restore any destination already replaced.
    for (const stagedFile of stagedFiles) {
      if (!fs.existsSync(stagedFile.temporaryPath)) {
        try {
          fs.writeFileSync(stagedFile.fullPath, stagedFile.originalContent)
        } catch {
          // Preserve the original error; CI's clean checkout remains recoverable.
        }
      }
    }
    throw error
  } finally {
    for (const stagedFile of stagedFiles) {
      try {
        fs.unlinkSync(stagedFile.temporaryPath)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
  }
}

function log(message) {
  console.log(`  ${message}`)
}

export function setReleaseVersion(repoRoot, options) {
  const changes = prepareVersionChanges(repoRoot, options)
  writeVersionChanges(repoRoot, changes)

  log(
    `src-tauri/tauri.conf.json → ${options.version} (updater: ${options.updaterPubkey ? 'enabled' : 'disabled'})`,
  )
  for (const relativePath of [...packageJsonFiles, ...cargoFiles]) {
    log(`${relativePath} → ${options.version}`)
  }
  if (options.windowsSignCommand) {
    log('src-tauri/tauri.windows.conf.json → signCommand added')
  }

  console.log(`set-version ok: ${options.version} (channel: ${options.channel})`)
}

function main() {
  try {
    const options = parseCliArguments(process.argv.slice(2))
    setReleaseVersion(defaultRepoRoot, options)
  } catch (error) {
    const prefix = error instanceof CliUsageError ? 'set-version usage error' : 'set-version error'
    console.error(`${prefix}: ${error.message}`)
    process.exitCode = error instanceof CliUsageError ? 2 : 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
