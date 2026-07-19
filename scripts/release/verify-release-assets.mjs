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
  `AX.Studio_${version}_aarch64.dmg`,
  `ax-studio-mac-arm64-${version}.zip`,
  `AX.Studio_${version}_x64-setup.exe`,
  `AX.Studio_${version}_arm64-setup.exe`,
  'latest.json',
]
const optionalAssets = [
  'AX.Studio.app.tar.gz',
  `AX.Studio_${version}_x64-portable.exe`,
  `AX.Studio_${version}_arm64-portable.exe`,
]
const requiredMetadataAssets = ['ax-minisign.pub']

function fail(message) {
  console.error(`release asset error: ${message}`)
  process.exitCode = 1
}

for (const asset of [...requiredAssets, ...requiredMetadataAssets]) {
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
  if (/linux|amd64|appimage|\.deb/i.test(asset)) {
    fail(`unsupported platform asset in release: ${asset}`)
  }
}

const signableAssets = [...requiredAssets, ...optionalAssets].filter((asset) => assets.includes(asset))
for (const asset of signableAssets) {
  const signature = `${asset}.minisig`
  if (assets.includes(signature)) {
    continue
  }

  fail(`missing minisign signature: ${signature}`)
}

if (process.exitCode) {
  process.exit(process.exitCode)
}

console.log(`release assets ok: ${tag} contains macOS arm64 + Windows x64/ARM64 artifacts`)
