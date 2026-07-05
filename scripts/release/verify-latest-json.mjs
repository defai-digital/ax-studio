#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const args = new Map()

for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index]
  const value = process.argv[index + 1]

  if (!key.startsWith('--') || value === undefined || value.startsWith('--')) {
    console.error(`usage: node scripts/release/verify-latest-json.mjs --file <path> --version <version>`)
    process.exit(2)
  }

  args.set(key.slice(2), value)
  index += 1
}

function required(name) {
  const value = args.get(name)
  if (!value) {
    console.error(`missing required argument: --${name}`)
    process.exit(2)
  }
  return value
}

const filePath = path.resolve(repoRoot, required('file'))
const expectedVersion = required('version')
const latest = JSON.parse(fs.readFileSync(filePath, 'utf8'))
const platforms = Object.keys(latest.platforms ?? {})
const expectedPlatforms = ['darwin-aarch64', 'windows-x86_64', 'windows-aarch64']

function fail(message) {
  console.error(`latest.json error: ${message}`)
  process.exitCode = 1
}

if (latest.version !== expectedVersion) {
  fail(`version must be ${expectedVersion}, got ${latest.version}`)
}

if (JSON.stringify([...platforms].sort()) !== JSON.stringify([...expectedPlatforms].sort())) {
  fail(`platforms must be ${expectedPlatforms.join(', ')}, got ${platforms.join(', ') || '(none)'}`)
}

const darwin = latest.platforms?.['darwin-aarch64']
if (!darwin?.signature) {
  console.warn('warning: darwin-aarch64 signature is empty — updater will not work until TAURI_SIGNING_PRIVATE_KEY is configured')
}

if (!darwin?.url) {
  fail('darwin-aarch64 url is required')
}

if (darwin?.url && !/\/Ax-Studio(?:-[A-Za-z0-9.-]+)?(?:_|\.)/.test(darwin.url)) {
  fail(`darwin-aarch64 url does not look like an Ax-Studio macOS artifact URL: ${darwin.url}`)
}

const windows = latest.platforms?.['windows-x86_64']
if (!windows?.signature) {
  console.warn('warning: windows-x86_64 signature is empty — updater will not work until TAURI_SIGNING_PRIVATE_KEY is configured')
}

if (!windows?.url) {
  console.warn('warning: windows-x86_64 url is empty — Windows build may not have completed')
}

if (windows?.url && !/\/Ax-Studio_.*_x64-setup\.exe$/.test(windows.url)) {
  fail(`windows-x86_64 url does not look like an Ax-Studio Windows NSIS installer URL: ${windows.url}`)
}

const windowsArm64 = latest.platforms?.['windows-aarch64']
if (!windowsArm64?.signature) {
  console.warn('warning: windows-aarch64 signature is empty — updater will not work until TAURI_SIGNING_PRIVATE_KEY is configured')
}

if (!windowsArm64?.url) {
  console.warn('warning: windows-aarch64 url is empty — Windows ARM64 build may not have completed')
}

if (windowsArm64?.url && !/\/Ax-Studio_.*_arm64-setup\.exe$/.test(windowsArm64.url)) {
  fail(`windows-aarch64 url does not look like an Ax-Studio Windows ARM64 NSIS installer URL: ${windowsArm64.url}`)
}

if (process.exitCode) {
  process.exit(process.exitCode)
}

console.log(`latest.json ok: ${expectedVersion} for darwin-aarch64 + windows-x86_64 + windows-aarch64`)
