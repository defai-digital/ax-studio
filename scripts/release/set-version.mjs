#!/usr/bin/env node

/**
 * Centralized version-bumping script for AX Studio.
 *
 * Updates version strings across tauri.conf.json, Cargo.toml files,
 * package.json files, and optionally configures updater artifacts and
 * Windows code-signing — replacing duplicated shell blocks in CI.
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
import { execFileSync, spawnSync } from 'node:child_process'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const args = new Map()
const flags = new Set()

for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index]

  if (!key.startsWith('--')) {
    continue
  }

  const name = key.slice(2)
  const next = process.argv[index + 1]

  // Boolean flags: no value follows, or next arg is also a flag
  if (next === undefined || next.startsWith('--')) {
    flags.add(name)
  } else {
    args.set(name, next)
    index += 1
  }
}

function flag(name) {
  return flags.has(name)
}

function required(name) {
  const value = args.get(name)
  if (!value) {
    console.error(`missing required argument: --${name}`)
    process.exit(2)
  }
  return value
}

const version = required('version')
const channel = args.get('channel') ?? 'stable'
const updaterPubkey = args.get('updater-pubkey') ?? ''
const windowsSignCommand = flag('windows-sign-command')

// ── Validate ────────────────────────────────────────────────────────

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`version must be a semantic version (e.g. 1.3.3), got: ${version}`)
  process.exit(2)
}

// ── Helpers ─────────────────────────────────────────────────────────

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'))
}

function writeJson(relativePath, data) {
  fs.writeFileSync(path.join(repoRoot, relativePath), `${JSON.stringify(data, null, 2)}\n`)
}

/** Replace the first `version = "..."` under [package] in a Cargo.toml. */
function patchCargoVersion(relativePath) {
  const fullPath = path.join(repoRoot, relativePath)
  let content = fs.readFileSync(fullPath, 'utf8')

  // Match from [package] to the next section header (or end of file).
  // No `m` flag so $ only matches at end-of-string, preventing the lazy
  // quantifier from stopping at the first line break.
  const packageSection = /^(\[package\][\s\S]*?)(?=\n\[|$)/
  content = content.replace(packageSection, (section) =>
    section.replace(/^(version\s*=\s*)"[^"]*"/m, `$1"${version}"`)
  )

  fs.writeFileSync(fullPath, content)
}

function log(message) {
  console.log(`  ${message}`)
}

// ── 1. tauri.conf.json ─────────────────────────────────────────────

const tauriConfig = readJson('src-tauri/tauri.conf.json')
tauriConfig.version = version

if (updaterPubkey) {
  tauriConfig.bundle = { ...tauriConfig.bundle, createUpdaterArtifacts: true }
  tauriConfig.plugins = {
    ...tauriConfig.plugins,
    updater: { ...tauriConfig.plugins?.updater, pubkey: updaterPubkey },
  }
} else {
  tauriConfig.bundle = { ...tauriConfig.bundle, createUpdaterArtifacts: false }
}

writeJson('src-tauri/tauri.conf.json', tauriConfig)
log(`src-tauri/tauri.conf.json → ${version} (updater: ${updaterPubkey ? 'enabled' : 'disabled'})`)

// ── 2. web-app/package.json ────────────────────────────────────────

const webPkg = readJson('web-app/package.json')
webPkg.version = version
writeJson('web-app/package.json', webPkg)
log(`web-app/package.json → ${version}`)

// ── 3. Tauri plugin package.json files ─────────────────────────────

const plugins = ['tauri-plugin-hardware', 'tauri-plugin-llamacpp']

for (const plugin of plugins) {
  const pkgPath = `src-tauri/plugins/${plugin}/package.json`
  const pkg = readJson(pkgPath)
  pkg.version = version
  writeJson(pkgPath, pkg)
  log(`${pkgPath} → ${version}`)
}

// ── 4. Cargo.toml version fields ───────────────────────────────────

const cargoFiles = [
  'src-tauri/Cargo.toml',
  'src-tauri/plugins/tauri-plugin-hardware/Cargo.toml',
  'src-tauri/plugins/tauri-plugin-llamacpp/Cargo.toml',
]

for (const cargoFile of cargoFiles) {
  patchCargoVersion(cargoFile)
  log(`${cargoFile} → ${version}`)
}

// ── 5. Add devtools feature to tauri dependency (via ctoml) ────────

const hasCtoml = !spawnSync('ctoml', ['--help'], { stdio: 'ignore' }).error

if (hasCtoml) {
  try {
    execFileSync('ctoml', ['src-tauri/Cargo.toml', 'dependencies.tauri.features[]', 'devtools'], {
      cwd: repoRoot,
      stdio: 'pipe',
    })
    log('src-tauri/Cargo.toml → added devtools to tauri features')
  } catch (err) {
    console.warn(`  warning: ctoml devtools toggle failed: ${err.message}`)
  }
} else {
  console.warn('  warning: ctoml not found — skipping devtools feature toggle')
}

// ── 6. Windows sign command (optional) ─────────────────────────────

if (windowsSignCommand) {
  const winConfigPath = 'src-tauri/tauri.windows.conf.json'
  const winConfig = readJson(winConfigPath)

  if (!winConfig.bundle) winConfig.bundle = {}
  if (!winConfig.bundle.windows) winConfig.bundle.windows = {}

  winConfig.bundle.windows.signCommand = 'powershell -ExecutionPolicy Bypass -File ./sign.ps1 %1'

  writeJson(winConfigPath, winConfig)
  log(`${winConfigPath} → signCommand added`)
}

// ── Done ───────────────────────────────────────────────────────────

console.log(`set-version ok: ${version} (channel: ${channel})`)
