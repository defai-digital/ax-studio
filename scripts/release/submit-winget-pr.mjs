#!/usr/bin/env node

/**
 * Open (or dry-run) a PR against microsoft/winget-pkgs for DEFAI.AXStudio.
 *
 * Intended for post-publish release CI only: installer URLs must resolve on a
 * public GitHub release. Does not claim the package is live until the PR is
 * accepted by winget-pkgs maintainers.
 *
 * Usage:
 *   node scripts/release/submit-winget-pr.mjs \
 *     --version 2.2.0 \
 *     --manifests-dir ./windows-distribution/winget \
 *     [--fork owner/winget-pkgs] \
 *     [--repo defai-digital/ax-studio] \
 *     [--dry-run]
 *
 * Env:
 *   WINGET_PKGS_TOKEN  — GitHub token with push access to the fork and ability
 *                        to open PRs against microsoft/winget-pkgs
 *   GH_TOKEN / GITHUB_TOKEN — used for release asset download when re-hashing
 */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { wingetPackageRelativeDir } from './write-winget-manifest.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const args = new Map()
const flags = new Set()

for (let index = 2; index < process.argv.length; index += 1) {
  const token = process.argv[index]
  if (token === '--dry-run') {
    flags.add('dry-run')
    continue
  }
  if (!token.startsWith('--')) {
    console.error(`unexpected argument: ${token}`)
    process.exit(2)
  }
  const key = token.slice(2)
  const value = process.argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    console.error(`missing value for --${key}`)
    process.exit(2)
  }
  args.set(key, value)
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

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: options.env ?? process.env,
    cwd: options.cwd,
  })
  if (result.error) throw result.error
  if ((result.status ?? 1) !== 0) {
    const detail = options.capture
      ? `${result.stderr || result.stdout || ''}`.trim()
      : ''
    throw new Error(
      `${command} ${commandArgs.join(' ')} failed${detail ? `: ${detail}` : ''}`,
    )
  }
  return result
}

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase()
}

function readInstallerShaFromManifest(installerYaml) {
  const text = fs.readFileSync(installerYaml, 'utf8')
  const digests = {}
  const archBlocks = text.split(/- Architecture:/).slice(1)
  for (const block of archBlocks) {
    const archMatch = block.match(/^\s*(\w+)/)
    const shaMatch = block.match(/InstallerSha256:\s*([0-9A-Fa-f]{64})/)
    if (archMatch && shaMatch) {
      digests[archMatch[1].trim().toLowerCase()] = shaMatch[1].toUpperCase()
    }
  }
  return digests
}

const version = required('version')
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`version must look like 2.2.0, got: ${version}`)
  process.exit(2)
}

const manifestsDir = path.resolve(required('manifests-dir'))
const packageIdentifier = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'docs/release/windows-cert.json'), 'utf8'),
).packageIdentifier || 'DEFAI.AXStudio'
const relativePackageDir = wingetPackageRelativeDir(packageIdentifier)
const versionManifestDir = path.join(manifestsDir, relativePackageDir, version)

for (const name of [
  `${packageIdentifier}.yaml`,
  `${packageIdentifier}.locale.en-US.yaml`,
  `${packageIdentifier}.installer.yaml`,
]) {
  const full = path.join(versionManifestDir, name)
  if (!fs.existsSync(full)) {
    console.error(`missing winget manifest: ${full}`)
    process.exit(2)
  }
}

const installerYaml = path.join(
  versionManifestDir,
  `${packageIdentifier}.installer.yaml`,
)
const expectedDigests = readInstallerShaFromManifest(installerYaml)
if (!expectedDigests.x64 || !expectedDigests.arm64) {
  console.error('installer manifest must declare x64 and arm64 InstallerSha256 digests')
  process.exit(2)
}

const productRepo = args.get('repo') || 'defai-digital/ax-studio'
const dryRun = flags.has('dry-run')
const fork = args.get('fork') || process.env.WINGET_PKGS_FORK || ''
const token =
  process.env.WINGET_PKGS_TOKEN ||
  process.env.GH_TOKEN ||
  process.env.GITHUB_TOKEN ||
  ''

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ax-winget-submit-'))
const downloadDir = path.join(workDir, 'installers')
fs.mkdirSync(downloadDir, { recursive: true })

const installers = [
  {
    arch: 'x64',
    name: `AX.Studio_${version}_x64-setup.exe`,
    expected: expectedDigests.x64,
  },
  {
    arch: 'arm64',
    name: `AX.Studio_${version}_arm64-setup.exe`,
    expected: expectedDigests.arm64,
  },
]

console.log(`Verifying published installers for v${version} from ${productRepo}...`)
const ghEnv = {
  ...process.env,
  GH_TOKEN: token || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '',
}

try {
  for (const installer of installers) {
    const dest = path.join(downloadDir, installer.name)
    if (dryRun && process.env.WINGET_SUBMIT_SKIP_DOWNLOAD === '1') {
      // Unit/dry path: trust manifest hashes when download is skipped explicitly.
      console.log(`[dry-run] skip download ${installer.name}`)
      continue
    }

    run(
      'gh',
      [
        'release',
        'download',
        `v${version}`,
        '--repo',
        productRepo,
        '--pattern',
        installer.name,
        '--dir',
        downloadDir,
      ],
      { env: ghEnv },
    )

    if (!fs.existsSync(dest)) {
      throw new Error(`failed to download ${installer.name}`)
    }
    const actual = sha256File(dest)
    if (actual !== installer.expected) {
      throw new Error(
        `SHA-256 mismatch for ${installer.name}: manifest ${installer.expected}, downloaded ${actual}`,
      )
    }
    console.log(`OK ${installer.name} ${actual}`)
  }
} catch (error) {
  if (dryRun) {
    console.warn(`[dry-run] installer re-hash skipped or failed: ${error.message}`)
  } else {
    console.error(error.message || error)
    process.exit(1)
  }
}

if (dryRun) {
  console.log('[dry-run] winget manifests ready:')
  console.log(`  ${versionManifestDir}`)
  console.log(`  package: ${packageIdentifier}@${version}`)
  console.log(`  relative path: manifests/${relativePackageDir}/${version}/`)
  if (!fork) {
    console.log('[dry-run] set --fork owner/winget-pkgs and WINGET_PKGS_TOKEN to open a PR')
  }
  process.exit(0)
}

if (!token) {
  console.error('WINGET_PKGS_TOKEN (or GH_TOKEN) is required to open a winget-pkgs PR')
  process.exit(1)
}

if (!fork || !fork.includes('/')) {
  console.error('missing --fork owner/repo (your fork of microsoft/winget-pkgs)')
  process.exit(1)
}

const cloneDir = path.join(workDir, 'winget-pkgs')
const branch = `${packageIdentifier}-${version}`.replace(/[^A-Za-z0-9._-]/g, '-')
const forkUrl = `https://x-access-token:${token}@github.com/${fork}.git`

console.log(`Cloning fork ${fork}...`)
run('git', ['clone', '--depth', '1', forkUrl, cloneDir])
run('git', ['-C', cloneDir, 'remote', 'add', 'upstream', 'https://github.com/microsoft/winget-pkgs.git'])
run('git', ['-C', cloneDir, 'fetch', '--depth', '1', 'upstream', 'master'])
run('git', ['-C', cloneDir, 'checkout', '-B', branch, 'upstream/master'])

const destDir = path.join(cloneDir, 'manifests', relativePackageDir, version)
fs.mkdirSync(destDir, { recursive: true })
for (const name of fs.readdirSync(versionManifestDir)) {
  fs.copyFileSync(path.join(versionManifestDir, name), path.join(destDir, name))
}

run('git', ['-C', cloneDir, 'config', 'user.name', 'github-actions[bot]'])
run('git', ['-C', cloneDir, 'config', 'user.email', 'github-actions[bot]@users.noreply.github.com'])
run('git', ['-C', cloneDir, 'add', `manifests/${relativePackageDir}/${version}`])
const status = run('git', ['-C', cloneDir, 'status', '--porcelain'], { capture: true })
if (!String(status.stdout || '').trim()) {
  console.log('No winget manifest changes to commit (version may already exist on fork).')
  process.exit(0)
}

run('git', [
  '-C',
  cloneDir,
  'commit',
  '-m',
  `New version: ${packageIdentifier} version ${version}`,
])
run('git', ['-C', cloneDir, 'push', '-u', 'origin', branch, '--force'])

const prBody = [
  `This PR adds **${packageIdentifier}** version **${version}**.`,
  '',
  '### Installers',
  `- https://github.com/${productRepo}/releases/download/v${version}/AX.Studio_${version}_x64-setup.exe`,
  `- https://github.com/${productRepo}/releases/download/v${version}/AX.Studio_${version}_arm64-setup.exe`,
  '',
  '### Verification',
  `- Authenticode: DEFAI Private Limited (pinned in release CI)`,
  `- SHA-256 re-hashed against public release assets before opening this PR`,
  `- Release: https://github.com/${productRepo}/releases/tag/v${version}`,
  '',
  'Installer type: nullsoft (NSIS), scope: machine, silent via standard NSIS `/S`.',
].join('\n')

const prTitle = `New version: ${packageIdentifier} version ${version}`
const create = run(
  'gh',
  [
    'pr',
    'create',
    '--repo',
    'microsoft/winget-pkgs',
    '--head',
    `${fork.split('/')[0]}:${branch}`,
    '--base',
    'master',
    '--title',
    prTitle,
    '--body',
    prBody,
  ],
  { env: { ...process.env, GH_TOKEN: token }, capture: true },
)

console.log(String(create.stdout || '').trim() || 'winget-pkgs PR created')
