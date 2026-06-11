#!/usr/bin/env node

import { execFileSync } from 'node:child_process'

const args = new Map()

for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index]
  const value = process.argv[index + 1]

  if (!key.startsWith('--') || value === undefined || value.startsWith('--')) {
    console.error(`usage: node scripts/release/verify-release-assets.mjs --repo <owner/name> --tag <tag> --version <version>`)
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

const repo = required('repo')
const tag = required('tag')
const version = required('version')
const output = execFileSync('gh', ['release', 'view', tag, '--repo', repo, '--json', 'assets', '--jq', '.assets[].name'], {
  encoding: 'utf8',
})

const assets = output
  .split('\n')
  .map((asset) => asset.trim())
  .filter(Boolean)

const requiredAssets = [
  `Ax-Studio_${version}_aarch64.dmg`,
  `ax-studio-mac-arm64-${version}.zip`,
  'latest.json',
]
// Only present when TAURI_SIGNING_PRIVATE_KEY is configured
const optionalAssets = ['Ax-Studio.app.tar.gz']

function fail(message) {
  console.error(`release asset error: ${message}`)
  process.exitCode = 1
}

for (const asset of requiredAssets) {
  if (!assets.includes(asset)) {
    fail(`missing asset: ${asset}`)
  }
}

for (const asset of optionalAssets) {
  if (!assets.includes(asset)) {
    console.warn(`warning: optional asset not present (requires updater signing): ${asset}`)
  }
}

for (const asset of assets) {
  if (/windows|win|x64|linux|amd64|appimage|\.deb|\.msi|setup\.exe/i.test(asset)) {
    fail(`unsupported platform asset in macOS-only release: ${asset}`)
  }
}

const signableAssets = [...requiredAssets, ...optionalAssets].filter((asset) => asset !== 'latest.json' && assets.includes(asset))
for (const asset of signableAssets) {
  const signature = `${asset}.minisig`
  if (assets.includes(signature)) {
    continue
  }

  console.warn(`warning: missing optional minisign signature: ${signature}`)
}

if (process.exitCode) {
  process.exit(process.exitCode)
}

console.log(`release assets ok: ${tag} contains macOS arm64 artifacts only`)
