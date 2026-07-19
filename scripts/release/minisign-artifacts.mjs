#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const args = new Map()
const files = []
const booleanArgs = new Set(['verify-only', 'force'])

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index]

  if (arg.startsWith('--')) {
    const name = arg.slice(2)
    if (booleanArgs.has(name)) {
      args.set(name, 'true')
      continue
    }
    const value = process.argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      args.set(name, 'true')
    } else {
      args.set(name, value)
      index += 1
    }
  } else {
    files.push(arg)
  }
}

function usage() {
  console.error(`usage: node scripts/release/minisign-artifacts.mjs [--key-dir <path>] [--secret-key <path>] [--public-key <path>] [--pinned-public-key <path>] [--password-keychain-service <name>] [--password-keychain-account <name>] [--verify-only] [--force] <file...>`)
}

function fail(message) {
  console.error(`minisign error: ${message}`)
  process.exit(1)
}

function expandHome(value) {
  if (!value) {
    return value
  }

  if (value === '~') {
    return os.homedir()
  }

  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2))
  }

  return value
}

if (files.length === 0) {
  usage()
  process.exit(2)
}

const verifyOnly = args.get('verify-only') === 'true'
const force = args.get('force') === 'true'
const keyDir = path.resolve(repoRoot, expandHome(args.get('key-dir') ?? '~/signkey'))
const secretKey = path.resolve(repoRoot, expandHome(args.get('secret-key') ?? path.join(keyDir, 'ax.minisign.key')))
const publicKey = path.resolve(repoRoot, expandHome(args.get('public-key') ?? path.join(keyDir, 'ax.pub')))
const pinnedPublicKey = path.resolve(
  repoRoot,
  expandHome(
    args.get('pinned-public-key')
      ?? fileURLToPath(new URL('./ax-studio.minisign.pub', import.meta.url)),
  ),
)
const keychainService = args.get('password-keychain-service') ?? 'ax-minisign'
const keychainAccount = args.get('password-keychain-account') ?? 'ax-release'

if (spawnSync('minisign', ['-v'], { stdio: 'ignore' }).error) {
  fail('minisign is required')
}

if (!fs.existsSync(publicKey)) {
  fail(`public key not found: ${publicKey}`)
}

if (!fs.existsSync(pinnedPublicKey)) {
  fail(`pinned public key not found: ${pinnedPublicKey}`)
}

if (!verifyOnly && !fs.existsSync(secretKey)) {
  fail(`secret key not found: ${secretKey}`)
}

if (!verifyOnly && process.platform !== 'win32') {
  const secretMode = fs.statSync(secretKey).mode & 0o777
  const keyDirectoryMode = fs.statSync(path.dirname(secretKey)).mode & 0o777
  if ((secretMode & 0o077) !== 0) {
    fail(`secret key must not be group/world accessible: ${secretKey}`)
  }
  if ((keyDirectoryMode & 0o077) !== 0) {
    fail(`secret key directory must not be group/world accessible: ${path.dirname(secretKey)}`)
  }
}

function publicKeyMaterial(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/u)
    .map(line => line.trim())
    .find(line => line.startsWith('RW'))
}

const selectedPublicKey = publicKeyMaterial(publicKey)
const expectedPublicKey = publicKeyMaterial(pinnedPublicKey)
if (!selectedPublicKey || !expectedPublicKey) {
  fail('selected or pinned minisign public key is malformed')
}
if (selectedPublicKey !== expectedPublicKey) {
  fail(`public key does not match pinned release key: ${pinnedPublicKey}`)
}

let password
if (!verifyOnly) {
  password = process.env.MINISIGN_PASSWORD || undefined
  if (!password && process.platform === 'darwin') {
    const result = spawnSync(
      'security',
      ['find-generic-password', '-w', '-s', keychainService, '-a', keychainAccount],
      { encoding: 'utf8' },
    )
    if (result.status === 0) {
      password = result.stdout.trim()
    }
  }
}

for (const file of files) {
  const artifactPath = path.resolve(repoRoot, file)
  const signaturePath = `${artifactPath}.minisig`

  if (!fs.existsSync(artifactPath)) {
    fail(`artifact not found: ${artifactPath}`)
  }

  if (!verifyOnly) {
    if (fs.existsSync(signaturePath) && !force) {
      fail(`signature already exists: ${signaturePath}. Pass --force to overwrite.`)
    }
    if (force) {
      fs.rmSync(signaturePath, { force: true })
    }

    const signArgs = ['-S', '-s', secretKey, '-m', artifactPath]
    const digest = crypto
      .createHash('sha256')
      .update(fs.readFileSync(artifactPath))
      .digest('hex')
    const signedAt = new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z')
    signArgs.push(
      '-x',
      signaturePath,
      '-c',
      'AX Studio minisign signature',
      '-t',
      `AX Studio release ${path.basename(artifactPath)} sha256=${digest} signed=${signedAt}`,
    )

    if (password) {
      execFileSync('minisign', signArgs, {
        stdio: ['pipe', 'inherit', 'inherit'],
        input: `${password}\n`,
        env: process.env,
      })
    } else {
      // Let Minisign prompt when neither the environment nor Keychain has the
      // shared release-key password.
      execFileSync('minisign', signArgs, {
        stdio: 'inherit',
        env: process.env,
      })
    }
  }

  execFileSync('minisign', ['-Vm', artifactPath, '-p', publicKey, '-x', signaturePath], {
    stdio: 'inherit',
    env: process.env,
  })
}

console.log(`minisign ok: ${files.length} artifact(s)`)
