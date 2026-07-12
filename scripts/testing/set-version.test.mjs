import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CliUsageError,
  parseCliArguments,
  patchCargoPackageVersion,
  prepareVersionChanges,
  writeVersionChanges,
} from '../release/set-version.mjs'

const temporaryRoots = []

function writeFixtureFile(root, relativePath, content) {
  const fullPath = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(
    fullPath,
    typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`,
  )
}

function createReleaseFixture({ invalidLastCargo = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ax-studio-set-version-'))
  temporaryRoots.push(root)

  writeFixtureFile(root, 'src-tauri/tauri.conf.json', {
    version: '1.0.0',
    bundle: { active: true, createUpdaterArtifacts: false },
    plugins: {
      updater: { pubkey: 'old-key', endpoints: ['https://updates.example/latest.json'] },
    },
  })
  writeFixtureFile(root, 'web-app/package.json', { name: 'web-app', version: '1.0.0' })
  writeFixtureFile(root, 'src-tauri/plugins/tauri-plugin-hardware/package.json', {
    name: 'hardware',
    version: '1.0.0',
  })
  writeFixtureFile(root, 'src-tauri/plugins/tauri-plugin-llamacpp/package.json', {
    name: 'llamacpp',
    version: '1.0.0',
  })
  writeFixtureFile(
    root,
    'src-tauri/Cargo.toml',
    '[package]\nname = "ax-studio"\nversion = "1.0.0"\n\n[dependencies]\nserde = "1.0"\n',
  )
  writeFixtureFile(
    root,
    'src-tauri/plugins/tauri-plugin-hardware/Cargo.toml',
    '[package]\nname = "hardware"\nversion = "1.0.0"\n\n[dependencies]\ntauri = "2"\n',
  )
  writeFixtureFile(
    root,
    'src-tauri/plugins/tauri-plugin-llamacpp/Cargo.toml',
    invalidLastCargo
      ? '[package]\nname = "llamacpp"\n\n[dependencies]\ntauri = "2"\n'
      : '[package]\nname = "llamacpp"\nversion = "1.0.0"\n\n[dependencies]\ntauri = "2"\n',
  )
  writeFixtureFile(root, 'src-tauri/tauri.windows.conf.json', {
    bundle: { windows: { wix: { language: 'en-US' } } },
  })

  return root
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('set-version release boundary', () => {
  it('parses only the documented release arguments', () => {
    expect(
      parseCliArguments([
        '--version',
        '2.3.4',
        '--channel',
        'beta',
        '--updater-pubkey',
        'signed-key',
        '--windows-sign-command',
      ]),
    ).toEqual({
      version: '2.3.4',
      channel: 'beta',
      updaterPubkey: 'signed-key',
      windowsSignCommand: true,
    })

    expect(parseCliArguments(['--version', '2.3.4'])).toEqual({
      version: '2.3.4',
      channel: 'stable',
      updaterPubkey: '',
      windowsSignCommand: false,
    })
  })

  it.each([
    [[], 'missing required argument'],
    [['--version'], 'missing value'],
    [['--version', 'v2.3.4'], 'semantic version'],
    [['--version', '2.3.4', '--channel', 'preview'], 'channel must be one of'],
    [['--version', '2.3.4', '--unknown'], 'unknown argument'],
    [['--version', '2.3.4', '--version', '2.3.5'], 'duplicate argument'],
    [['--version', '2.3.4', '--windows-sign-command', 'true'], 'unexpected positional'],
    [['--version', '2.3.4', '--updater-pubkey', ''], 'must not be empty'],
  ])('rejects unsafe CLI input %#', (argv, message) => {
    expect(() => parseCliArguments(argv)).toThrowError(CliUsageError)
    expect(() => parseCliArguments(argv)).toThrow(message)
  })

  it('updates only the package version in a Cargo manifest', () => {
    const source = [
      '[package]',
      'name = "app"',
      'version = "1.0.0" # release version',
      '',
      '[dependencies]',
      'version = "99.0.0"',
      '',
    ].join('\n')

    const updated = patchCargoPackageVersion(source, '2.0.1')
    expect(updated).toContain('version = "2.0.1" # release version')
    expect(updated).toContain('[dependencies]\nversion = "99.0.0"')
  })

  it('prepares and commits a deterministic beta release identity without devtools', () => {
    const root = createReleaseFixture()
    const options = {
      version: '2.3.4',
      channel: 'beta',
      updaterPubkey: 'signed-key',
      windowsSignCommand: true,
    }
    const originalTauri = fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8')

    const changes = prepareVersionChanges(root, options)
    const byPath = new Map(changes.map((change) => [change.relativePath, change.content]))
    const tauriConfig = JSON.parse(byPath.get('src-tauri/tauri.conf.json'))
    const windowsConfig = JSON.parse(byPath.get('src-tauri/tauri.windows.conf.json'))
    const rootCargo = byPath.get('src-tauri/Cargo.toml')

    expect(tauriConfig.version).toBe('2.3.4')
    expect(tauriConfig.bundle.createUpdaterArtifacts).toBe(true)
    expect(tauriConfig.plugins.updater.pubkey).toBe('signed-key')
    expect(rootCargo).toContain('name = "ax-studio-beta"')
    expect(rootCargo).toContain('version = "2.3.4"')
    expect(rootCargo).not.toContain('devtools')
    expect(windowsConfig.bundle.windows.wix).toEqual({ language: 'en-US' })
    expect(windowsConfig.bundle.windows.signCommand).toContain('./sign.ps1 %1')
    expect(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8')).toBe(
      originalTauri,
    )

    writeVersionChanges(root, changes)

    expect(JSON.parse(fs.readFileSync(path.join(root, 'web-app/package.json'), 'utf8')).version)
      .toBe('2.3.4')
    expect(fs.readFileSync(path.join(root, 'src-tauri/Cargo.toml'), 'utf8'))
      .toBe(rootCargo)
  })

  it('validates every target before changing any manifest', () => {
    const root = createReleaseFixture({ invalidLastCargo: true })
    const tauriPath = path.join(root, 'src-tauri/tauri.conf.json')
    const originalTauri = fs.readFileSync(tauriPath, 'utf8')

    expect(() =>
      prepareVersionChanges(root, {
        version: '2.3.4',
        channel: 'stable',
        updaterPubkey: '',
        windowsSignCommand: false,
      }),
    ).toThrow('must contain exactly one quoted version field')
    expect(fs.readFileSync(tauriPath, 'utf8')).toBe(originalTauri)
  })

  it('restores an already-replaced file when a later atomic rename fails', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ax-studio-version-rollback-'))
    temporaryRoots.push(root)
    writeFixtureFile(root, 'manifest.json', 'original\n')
    fs.mkdirSync(path.join(root, 'blocking-directory'))

    expect(() =>
      writeVersionChanges(root, [
        {
          relativePath: 'manifest.json',
          originalContent: 'original\n',
          content: 'updated\n',
        },
        {
          relativePath: 'blocking-directory',
          originalContent: '',
          content: 'cannot replace a directory\n',
        },
      ]),
    ).toThrow()
    expect(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).toBe('original\n')
  })
})
