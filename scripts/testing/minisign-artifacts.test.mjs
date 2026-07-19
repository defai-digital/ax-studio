import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const signer = path.join(repoRoot, 'scripts', 'release', 'minisign-artifacts.mjs')
const temporaryDirectories = []
const sharedPublicKey = readFileSync(
  path.join(repoRoot, 'docs', 'release', 'ax.minisign.pub'),
  'utf8',
)
const realMinisignAvailable = spawnSync('minisign', ['-v'], {
  stdio: 'ignore',
}).status === 0
const subprocessTestTimeout = 30_000

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function executable(file, source) {
  writeFileSync(file, `#!/usr/bin/env node\n${source}`)
  chmodSync(file, 0o755)
}

describe('minisign release artifact signer', () => {
  it.runIf(process.platform !== 'win32')(
    'uses the shared key names, pin, and generic macOS Keychain item',
    () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ax-studio-minisign-'))
    temporaryDirectories.push(root)

    const home = path.join(root, 'home')
    const keyDirectory = path.join(home, 'signkey')
    const binDirectory = path.join(root, 'bin')
    const artifact = path.join(root, 'artifact.zip')
    const log = path.join(root, 'minisign.log')
    const securityLog = path.join(root, 'security.log')

    mkdirSync(keyDirectory, { recursive: true, mode: 0o700 })
    mkdirSync(binDirectory)
    writeFileSync(path.join(keyDirectory, 'ax.minisign.key'), 'test secret key')
    chmodSync(path.join(keyDirectory, 'ax.minisign.key'), 0o600)
    writeFileSync(path.join(keyDirectory, 'ax.pub'), sharedPublicKey)
    writeFileSync(artifact, 'artifact')

    executable(
      path.join(binDirectory, 'minisign'),
      `
const fs = require('node:fs')
const args = process.argv.slice(2)
fs.appendFileSync(process.env.MINISIGN_TEST_LOG, JSON.stringify(args) + '\\n')
if (args.includes('-S')) {
  const message = args[args.indexOf('-m') + 1]
  fs.writeFileSync(message + '.minisig', 'test signature')
}
`
    )
    executable(
      path.join(binDirectory, 'security'),
      `
require('node:fs').appendFileSync(process.env.SECURITY_TEST_LOG, JSON.stringify(process.argv.slice(2)) + '\\n')
process.stdout.write('from-keychain\\n')
`
    )

    const result = spawnSync(process.execPath, [signer, artifact], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        PATH: `${binDirectory}${path.delimiter}${process.env.PATH}`,
        MINISIGN_TEST_LOG: log,
        SECURITY_TEST_LOG: securityLog,
        MINISIGN_PASSWORD: '',
      },
    })

    expect(result.status, result.stderr).toBe(0)
    const invocations = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    const signInvocation = invocations.find((args) => args.includes('-S'))
    const verifyInvocation = invocations.find((args) => args.includes('-Vm'))

    expect(signInvocation).toContain(path.join(keyDirectory, 'ax.minisign.key'))
    expect(verifyInvocation).toContain(path.join(keyDirectory, 'ax.pub'))
    const trustedComment = signInvocation[signInvocation.indexOf('-t') + 1]
    expect(trustedComment).toMatch(/AX Studio release artifact\.zip sha256=[0-9a-f]{64} signed=/u)
    if (process.platform === 'darwin') {
      const securityArgs = JSON.parse(readFileSync(securityLog, 'utf8').trim())
      expect(securityArgs).toContain('find-generic-password')
      expect(securityArgs).toContain('ax-minisign')
      expect(securityArgs).toContain('ax-release')
    }
    },
    subprocessTestTimeout,
  )

  it.runIf(process.platform !== 'win32')(
    'rejects a selected public key that differs from the committed pin',
    () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ax-studio-minisign-pin-'))
    temporaryDirectories.push(root)

    const keyDirectory = path.join(root, 'signkey')
    const binDirectory = path.join(root, 'bin')
    const artifact = path.join(root, 'artifact.zip')
    mkdirSync(keyDirectory, { mode: 0o700 })
    mkdirSync(binDirectory)
    writeFileSync(path.join(keyDirectory, 'ax.minisign.key'), 'test secret key')
    chmodSync(path.join(keyDirectory, 'ax.minisign.key'), 0o600)
    writeFileSync(
      path.join(keyDirectory, 'ax.pub'),
      'untrusted comment: wrong key\nRWS_WRONG_PUBLIC_KEY\n',
    )
    writeFileSync(artifact, 'artifact')
    executable(path.join(binDirectory, 'minisign'), 'process.exit(0)')

    const result = spawnSync(
      process.execPath,
      [signer, '--key-dir', keyDirectory, artifact],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDirectory}${path.delimiter}${process.env.PATH}`,
          MINISIGN_PASSWORD: 'test',
        },
      },
    )

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('public key does not match pinned release key')
    },
    subprocessTestTimeout,
  )

  it.runIf(process.platform !== 'win32')(
    'rejects a group-readable secret key',
    () => {
      const root = mkdtempSync(path.join(os.tmpdir(), 'ax-studio-minisign-mode-'))
      temporaryDirectories.push(root)
      const keyDirectory = path.join(root, 'signkey')
      const binDirectory = path.join(root, 'bin')
      const artifact = path.join(root, 'artifact.zip')
      mkdirSync(keyDirectory, { mode: 0o700 })
      mkdirSync(binDirectory)
      writeFileSync(path.join(keyDirectory, 'ax.minisign.key'), 'test secret key')
      chmodSync(path.join(keyDirectory, 'ax.minisign.key'), 0o640)
      writeFileSync(path.join(keyDirectory, 'ax.pub'), sharedPublicKey)
      writeFileSync(artifact, 'artifact')
      executable(path.join(binDirectory, 'minisign'), 'process.exit(0)')

      const result = spawnSync(
        process.execPath,
        [signer, '--key-dir', keyDirectory, artifact],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${binDirectory}${path.delimiter}${process.env.PATH}`,
            MINISIGN_PASSWORD: 'test',
          },
        },
      )

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('secret key must not be group/world accessible')
    },
    subprocessTestTimeout,
  )

  it.runIf(realMinisignAvailable)(
    'signs and verifies an artifact with the real Minisign CLI',
    () => {
      const root = mkdtempSync(path.join(os.tmpdir(), 'ax-studio-real-minisign-'))
      temporaryDirectories.push(root)

      const keyDirectory = path.join(root, 'signkey')
      const secretKey = path.join(keyDirectory, 'ax.minisign.key')
      const publicKey = path.join(keyDirectory, 'ax.pub')
      const artifact = path.join(root, 'artifact.zip')
      mkdirSync(keyDirectory, { mode: 0o700 })
      writeFileSync(artifact, 'real minisign integration artifact')

      const generated = spawnSync(
        'minisign',
        ['-G', '-W', '-s', secretKey, '-p', publicKey],
        { encoding: 'utf8' },
      )
      expect(generated.status, generated.stderr).toBe(0)
      chmodSync(secretKey, 0o600)

      const result = spawnSync(
        process.execPath,
        [
          signer,
          '--key-dir',
          keyDirectory,
          '--pinned-public-key',
          publicKey,
          artifact,
        ],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: { ...process.env, MINISIGN_PASSWORD: '' },
        },
      )

      expect(result.status, result.stderr).toBe(0)
      expect(readFileSync(`${artifact}.minisig`, 'utf8')).toContain(
        'AX Studio release artifact.zip sha256=',
      )
    },
    subprocessTestTimeout,
  )
})
