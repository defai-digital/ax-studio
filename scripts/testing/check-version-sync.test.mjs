import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  VersionSyncError,
  checkVersionSync,
  collectAppVersions,
  parseCliArguments,
} from '../release/check-version-sync.mjs'
import {
  cargoFiles,
  packageJsonFiles,
  tauriConfigPath,
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

function createSyncedFixture(version = '2.1.0') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ax-studio-version-sync-'))
  temporaryRoots.push(root)

  writeFixtureFile(root, tauriConfigPath, {
    version,
    bundle: { active: true },
  })
  for (const relativePath of packageJsonFiles) {
    writeFixtureFile(root, relativePath, { name: relativePath, version })
  }
  for (const relativePath of cargoFiles) {
    writeFixtureFile(
      root,
      relativePath,
      `[package]\nname = "pkg"\nversion = "${version}"\n\n[dependencies]\nserde = "1.0"\n`,
    )
  }
  return root
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('check-version-sync', () => {
  it('parses optional --expect', () => {
    expect(parseCliArguments([])).toEqual({ expect: undefined })
    expect(parseCliArguments(['--expect', '2.1.0'])).toEqual({ expect: '2.1.0' })
    expect(parseCliArguments(['--', '--expect', '2.1.0'])).toEqual({ expect: '2.1.0' })
    expect(() => parseCliArguments(['--expect'])).toThrow(VersionSyncError)
    expect(() => parseCliArguments(['--expect', 'v2.1.0'])).toThrow(/semantic version/)
    expect(() => parseCliArguments(['--unknown'])).toThrow(/unknown argument/)
  })

  it('accepts a fully synced tree', () => {
    const root = createSyncedFixture('2.1.0')
    const result = checkVersionSync(root)
    expect(result.version).toBe('2.1.0')
    expect(result.entries).toHaveLength(1 + packageJsonFiles.length + cargoFiles.length)
    expect(result.entries.every((entry) => entry.version === '2.1.0')).toBe(true)
  })

  it('fails when manifests disagree', () => {
    const root = createSyncedFixture('2.1.0')
    writeFixtureFile(root, 'web-app/package.json', { name: 'web-app', version: '1.3.7' })

    expect(() => collectAppVersions(root)).toThrow(/out of sync/)
    expect(() => collectAppVersions(root)).toThrow(/web-app\/package\.json: 1\.3\.7/)
  })

  it('fails when every manifest agrees on an invalid version', () => {
    const root = createSyncedFixture('not-semver')
    expect(() => collectAppVersions(root)).toThrow(/must be a semantic version/)
  })

  it('fails when --expect does not match the synced version', () => {
    const root = createSyncedFixture('2.1.0')
    expect(() => checkVersionSync(root, { expect: '2.0.0' })).toThrow(
      /app version is 2\.1\.0, expected 2\.0\.0/,
    )
  })

  it('fails when tauri.conf version is missing', () => {
    const root = createSyncedFixture('2.1.0')
    writeFixtureFile(root, tauriConfigPath, { productName: 'AX Studio' })
    expect(() => collectAppVersions(root)).toThrow(/must contain a string version field/)
  })
})
