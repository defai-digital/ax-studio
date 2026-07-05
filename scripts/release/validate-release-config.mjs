#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const stablePlatforms = ['darwin-aarch64', 'windows-x86_64', 'windows-aarch64']

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

if (tauriConfig.productName !== 'Ax-Studio') {
  fail(`src-tauri/tauri.conf.json productName must be Ax-Studio, got ${tauriConfig.productName}`)
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

const platforms = Object.keys(latestTemplate.platforms ?? {})
assertArrayEqual('src-tauri/latest.json.template platforms', platforms, stablePlatforms)

for (const platform of stablePlatforms) {
  const entry = latestTemplate.platforms?.[platform]
  if (!entry || typeof entry.signature !== 'string' || typeof entry.url !== 'string') {
    fail(`src-tauri/latest.json.template platform ${platform} must have signature and url string fields`)
  }
}

if (process.exitCode) {
  process.exit(process.exitCode)
}

console.log(`release config ok: stable platforms ${stablePlatforms.join(', ')}`)
