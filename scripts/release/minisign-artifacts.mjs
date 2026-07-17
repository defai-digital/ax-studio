#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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
  console.error(`usage: node scripts/release/minisign-artifacts.mjs [--key-dir <path>] [--secret-key <path>] [--public-key <path>] [--password-keychain-account <name>] [--verify-only] [--force] <file...>`)
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
const secretKey = path.resolve(repoRoot, expandHome(args.get('secret-key') ?? path.join(keyDir, 'ax-studio.minisign.key')))
const publicKey = path.resolve(repoRoot, expandHome(args.get('public-key') ?? path.join(keyDir, 'ax-studio.minisign.pub')))
const keychainAccount = args.get('password-keychain-account') ?? 'ax-studio-minisign'

if (spawnSync('minisign', ['-v'], { stdio: 'ignore' }).error) {
  fail('minisign is required')
}

if (!fs.existsSync(publicKey)) {
  fail(`public key not found: ${publicKey}`)
}

if (!verifyOnly && !fs.existsSync(secretKey)) {
  fail(`secret key not found: ${secretKey}`)
}

let password
if (!verifyOnly) {
  password = process.env.MINISIGN_PASSWORD

  if (!password && process.platform === 'darwin') {
    const result = spawnSync('security', ['find-generic-password', '-a', keychainAccount, '-w'], {
      encoding: 'utf8',
    })

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

    const signArgs = ['-S', '-s', secretKey, '-m', artifactPath]
    if (force) {
      signArgs.push('-x', signaturePath)
    }

    execFileSync('minisign', signArgs, {
      stdio: ['pipe', 'inherit', 'inherit'],
      input: password ? `${password}\n` : undefined,
      env: process.env,
    })
  }

  execFileSync('minisign', ['-Vm', artifactPath, '-p', publicKey, '-x', signaturePath], {
    stdio: 'inherit',
    env: process.env,
  })
}

console.log(`minisign ok: ${files.length} artifact(s)`)
