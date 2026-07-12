#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const stablePlatforms = ['darwin-aarch64', 'windows-x86_64', 'windows-aarch64']
const releaseWorkflowPaths = [
  '.github/workflows/template-tauri-build-windows-x64.yml',
  '.github/workflows/template-tauri-build-windows-arm64.yml',
]
const customNsisTemplatePath = 'src-tauri/tauri.bundle.windows.nsis.template'
const expectedWindowsSignCommand = 'powershell -ExecutionPolicy Bypass -File ./sign.ps1 %1'
const windowsLongPathsCommand = 'git config --global core.longpaths true'
const requiredUpdaterPermissions = [
  'updater:allow-check',
  'updater:allow-download-and-install',
]

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'))
}

function fail(message) {
  console.error(`release config error: ${message}`)
  process.exitCode = 1
}

function assertArrayEqual(name, actual, expected) {
  const sortedActual = [...actual].sort()
  const sortedExpected = [...expected].sort()

  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    fail(`${name} must be ${sortedExpected.join(', ')}, got ${sortedActual.join(', ') || '(none)'}`)
  }
}

const tauriConfig = readJson('src-tauri/tauri.conf.json')
const latestTemplate = readJson('src-tauri/latest.json.template')

if (tauriConfig.productName !== 'AX Studio') {
  fail(`src-tauri/tauri.conf.json productName must be AX Studio, got ${tauriConfig.productName}`)
}

if (tauriConfig.identifier !== 'ai.axstudio.app') {
  fail(`src-tauri/tauri.conf.json identifier must be ai.axstudio.app, got ${tauriConfig.identifier}`)
}

if (tauriConfig.bundle?.active !== true) {
  fail('src-tauri/tauri.conf.json bundle.active must be true')
}

if (tauriConfig.bundle?.createUpdaterArtifacts !== false) {
  fail('src-tauri/tauri.conf.json should keep bundle.createUpdaterArtifacts false in source; release CI enables it')
}

const endpoints = tauriConfig.plugins?.updater?.endpoints
if (!Array.isArray(endpoints) || endpoints.length === 0) {
  fail('src-tauri/tauri.conf.json must configure updater endpoints')
}

const activeCapabilityIds = tauriConfig.app?.security?.capabilities
if (!Array.isArray(activeCapabilityIds) || activeCapabilityIds.length === 0) {
  fail('src-tauri/tauri.conf.json must activate at least one capability')
} else {
  const mainWindowPermissions = new Set()
  for (const capabilityId of activeCapabilityIds) {
    if (typeof capabilityId !== 'string') continue

    const capabilityPath = `src-tauri/capabilities/${capabilityId}.json`
    if (!fs.existsSync(path.join(repoRoot, capabilityPath))) {
      fail(`active capability ${capabilityId} is missing ${capabilityPath}`)
      continue
    }

    const capability = readJson(capabilityPath)
    const windows = capability.windows ?? []
    if (!windows.includes('main') && !windows.includes('*')) continue

    for (const permission of capability.permissions ?? []) {
      const identifier =
        typeof permission === 'string' ? permission : permission?.identifier
      if (identifier) mainWindowPermissions.add(identifier)
    }
  }

  for (const permission of requiredUpdaterPermissions) {
    if (!mainWindowPermissions.has(permission)) {
      fail(`active main-window capabilities must grant ${permission}`)
    }
  }
}

const platforms = Object.keys(latestTemplate.platforms ?? {})
assertArrayEqual('src-tauri/latest.json.template platforms', platforms, stablePlatforms)

for (const platform of stablePlatforms) {
  const entry = latestTemplate.platforms?.[platform]
  if (!entry || typeof entry.signature !== 'string' || typeof entry.url !== 'string') {
    fail(`src-tauri/latest.json.template platform ${platform} must have signature and url string fields`)
  }
}

if (!fs.existsSync(path.join(repoRoot, customNsisTemplatePath))) {
  for (const workflowPath of releaseWorkflowPaths) {
    const workflow = fs.readFileSync(path.join(repoRoot, workflowPath), 'utf8')
    if (workflow.includes(customNsisTemplatePath)) {
      fail(`${workflowPath} references missing file ${customNsisTemplatePath}`)
    }
  }
}

for (const workflowPath of releaseWorkflowPaths) {
  const workflow = fs.readFileSync(path.join(repoRoot, workflowPath), 'utf8')
  if (!workflow.includes(windowsLongPathsCommand)) {
    fail(`${workflowPath} must enable Git long-path support with: ${windowsLongPathsCommand}`)
  }
  if (!workflow.includes('-name "ax-studio.exe"')) {
    fail(`${workflowPath} must recognize the raw Tauri portable binary ax-studio.exe`)
  }
}

const setVersionScript = fs.readFileSync(path.join(repoRoot, 'scripts/release/set-version.mjs'), 'utf8')
const windowsSignCommand = setVersionScript.match(
  /winConfig\.bundle\.windows\.signCommand\s*=\s*'([^']+)'/,
)?.[1]
if (windowsSignCommand !== expectedWindowsSignCommand) {
  fail(
    `scripts/release/set-version.mjs Windows sign command must be ${expectedWindowsSignCommand}, got ${windowsSignCommand ?? '(missing)'}`,
  )
}

if (process.exitCode) {
  process.exit(process.exitCode)
}

console.log(`release config ok: stable platforms ${stablePlatforms.join(', ')}`)
