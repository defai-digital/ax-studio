#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const args = new Map()

for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index]
  const value = process.argv[index + 1]

  if (!key.startsWith('--') || value === undefined || value.startsWith('--')) {
    console.error(
      `usage: node scripts/release/create-latest-json.mjs --version <version> --darwin-signature <signature> --darwin-url <url> [--windows-x64-signature <signature>] [--windows-x64-url <url>] [--windows-arm64-signature <signature>] [--windows-arm64-url <url>] --out <path>`
    )
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

const version = required('version')
const darwinSignature = args.get('darwin-signature') ?? ''
const darwinUrl = required('darwin-url')
const windowsX64Signature =
  args.get('windows-x64-signature') ?? args.get('windows-signature') ?? ''
const windowsX64Url = args.get('windows-x64-url') ?? args.get('windows-url') ?? ''
const windowsArm64Signature = args.get('windows-arm64-signature') ?? ''
const windowsArm64Url = args.get('windows-arm64-url') ?? ''
const outPath = path.resolve(repoRoot, required('out'))
const templatePath = path.join(repoRoot, 'src-tauri/latest.json.template')
const latest = JSON.parse(fs.readFileSync(templatePath, 'utf8'))

latest.version = version
latest.notes = latest.notes ?? ''
latest.pub_date = new Date().toISOString()
latest.platforms = {
  'darwin-aarch64': {
    signature: darwinSignature,
    url: darwinUrl,
  },
}

if (windowsX64Url) {
  latest.platforms['windows-x86_64'] = {
    signature: windowsX64Signature,
    url: windowsX64Url,
  }
}

if (windowsArm64Url) {
  latest.platforms['windows-aarch64'] = {
    signature: windowsArm64Signature,
    url: windowsArm64Url,
  }
}

fs.writeFileSync(outPath, `${JSON.stringify(latest, null, 2)}\n`)
console.log(`wrote ${path.relative(repoRoot, outPath)}`)
