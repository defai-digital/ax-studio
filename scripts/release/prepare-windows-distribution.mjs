#!/usr/bin/env node

/**
 * After signed Windows setup EXEs exist, write SHA256SUMS and winget manifests.
 *
 * Usage:
 *   node scripts/release/prepare-windows-distribution.mjs \
 *     --version 2.2.0 \
 *     --artifacts-dir ./artifacts \
 *     --out-dir ./windows-distribution
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const args = new Map()

for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index]
  const value = process.argv[index + 1]

  if (!key.startsWith('--') || value === undefined || value.startsWith('--')) {
    console.error(
      'usage: node scripts/release/prepare-windows-distribution.mjs --version <ver> --artifacts-dir <dir> --out-dir <dir> [--release-date YYYY-MM-DD]',
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

function sha256File(filePath) {
  const hash = createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

const version = required('version')
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`version must look like 2.2.0, got: ${version}`)
  process.exit(2)
}

const artifactsDir = path.resolve(required('artifacts-dir'))
const outDir = path.resolve(required('out-dir'))
const releaseDate = args.get('release-date') || new Date().toISOString().slice(0, 10)

if (!fs.existsSync(artifactsDir)) {
  console.error(`artifacts directory does not exist: ${artifactsDir}`)
  process.exit(2)
}

const requiredInstallers = [
  `AX.Studio_${version}_x64-setup.exe`,
  `AX.Studio_${version}_arm64-setup.exe`,
]

const installerPaths = {}
for (const name of requiredInstallers) {
  const fullPath = path.join(artifactsDir, name)
  if (!fs.existsSync(fullPath)) {
    console.error(`required installer missing: ${fullPath}`)
    process.exit(2)
  }
  installerPaths[name] = fullPath
}

fs.mkdirSync(outDir, { recursive: true })

const lines = []
const digests = {}
for (const name of requiredInstallers) {
  const digest = sha256File(installerPaths[name])
  digests[name] = digest
  lines.push(`${digest}  ${name}`)
}

const sha256Path = path.join(outDir, 'SHA256SUMS-windows.txt')
fs.writeFileSync(sha256Path, `${lines.join('\n')}\n`, 'utf8')
console.log(`wrote ${path.relative(process.cwd(), sha256Path)}`)

const wingetOut = path.join(outDir, 'winget')
const wingetResult = spawnSync(
  process.execPath,
  [
    path.join(repoRoot, 'scripts/release/write-winget-manifest.mjs'),
    '--version',
    version,
    '--x64-sha256',
    digests[`AX.Studio_${version}_x64-setup.exe`],
    '--arm64-sha256',
    digests[`AX.Studio_${version}_arm64-setup.exe`],
    '--out-dir',
    wingetOut,
    '--release-date',
    releaseDate,
  ],
  { cwd: repoRoot, encoding: 'utf8' },
)

if (wingetResult.status !== 0) {
  console.error(wingetResult.stdout || '')
  console.error(wingetResult.stderr || '')
  process.exit(wingetResult.status || 1)
}
if (wingetResult.stdout) process.stdout.write(wingetResult.stdout)

const summary = {
  version,
  releaseDate,
  installers: requiredInstallers.map((name) => ({
    name,
    sha256: digests[name],
  })),
  packageIdentifier: JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'docs/release/windows-cert.json'), 'utf8'),
  ).packageIdentifier,
}

fs.writeFileSync(path.join(outDir, 'windows-distribution.json'), `${JSON.stringify(summary, null, 2)}\n`)
console.log(`wrote ${path.relative(process.cwd(), path.join(outDir, 'windows-distribution.json'))}`)
console.log(`windows distribution ready under ${path.relative(process.cwd(), outDir)}`)
