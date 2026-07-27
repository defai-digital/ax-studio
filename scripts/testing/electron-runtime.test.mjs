import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import {
  resolveElectronInvocation,
  resolveYarnInvocation,
} from '../electron-runtime.mjs'

const tempDirs = []
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function createTempRepo() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'ax-studio-electron-runtime-'))
  tempDirs.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('Electron runtime process resolution', () => {
  it('runs the stable Corepack Yarn script through Node', () => {
    const repoRoot = createTempRepo()
    const corepackRoot = path.join(repoRoot, 'corepack')
    const corepackYarn = path.join(corepackRoot, 'dist', 'yarn.js')
    const yarnShim = path.join(repoRoot, 'yarn')
    mkdirSync(path.dirname(corepackYarn), { recursive: true })
    writeFileSync(corepackYarn, '')
    writeFileSync(yarnShim, '#!/bin/sh\n')

    expect(
      resolveYarnInvocation(repoRoot, {
        nodePath: 'node.exe',
        npmExecPath: yarnShim,
        corepackRoot,
      })
    ).toEqual({
      cmd: 'node.exe',
      argsPrefix: [corepackYarn],
    })
  })

  it('prefers a repository-pinned Yarn release', () => {
    const repoRoot = createTempRepo()
    const releasesDir = path.join(repoRoot, '.yarn', 'releases')
    const yarnRelease = path.join(releasesDir, 'yarn-4.5.3.cjs')
    mkdirSync(releasesDir, { recursive: true })
    writeFileSync(yarnRelease, '')

    expect(
      resolveYarnInvocation(repoRoot, {
        nodePath: 'node.exe',
        npmExecPath: path.join(repoRoot, 'temporary-yarn'),
        corepackRoot: null,
      })
    ).toEqual({
      cmd: 'node.exe',
      argsPrefix: [yarnRelease],
    })
  })

  it('falls back to Yarn generated command wrappers on Windows', () => {
    const repoRoot = createTempRepo()
    const yarnShim = path.join(repoRoot, 'yarn')
    const yarnCommand = `${yarnShim}.cmd`
    writeFileSync(yarnShim, '#!/bin/sh\n')
    writeFileSync(yarnCommand, '@echo off\r\n')

    expect(
      resolveYarnInvocation(repoRoot, {
        npmExecPath: yarnShim,
        corepackRoot: null,
        platform: 'win32',
      })
    ).toEqual({
      cmd: yarnCommand,
      argsPrefix: [],
      spawnOptions: { shell: true },
    })
  })

  it('runs the Electron JavaScript CLI through Node', () => {
    const repoRoot = createTempRepo()
    const electronCli = path.join(
      repoRoot,
      'electron',
      'node_modules',
      'electron',
      'cli.js'
    )
    mkdirSync(path.dirname(electronCli), { recursive: true })
    writeFileSync(electronCli, '')

    expect(resolveElectronInvocation(repoRoot, { nodePath: 'node.exe' })).toEqual({
      cmd: 'node.exe',
      argsPrefix: [electronCli],
    })
  })
})

describe('Electron build scripts', () => {
  it('keeps renderer staging out of development startup', () => {
    const electronPackage = JSON.parse(
      readFileSync(path.join(repoRoot, 'electron', 'package.json'), 'utf8')
    )
    const devLauncher = readFileSync(
      path.join(repoRoot, 'scripts', 'dev-electron.mjs'),
      'utf8'
    )

    expect(electronPackage.scripts['build:dev']).toBe('yarn build:runtime')
    expect(electronPackage.scripts.build).toContain('copy-renderer.mjs')
    expect(electronPackage.scripts['build:dev']).not.toContain('copy-renderer.mjs')
    expect(devLauncher).toContain(
      "yarnArgs('workspace', '@ax-studio/electron', 'build:dev')"
    )
  })
})
