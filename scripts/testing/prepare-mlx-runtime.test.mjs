import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  isTargetedMlxInstallation,
  macosWheelPlatform,
  parseMacosMinimumVersion,
  prepareMlxRuntime,
  readMinimumMacosVersion,
  readPinnedMlxVersion,
} from '../prepare-mlx-runtime.mjs'

const temporaryDirectories = []
const runtimeFiles = ['libmlx.dylib', 'libjaccl.dylib', 'mlx.metallib']

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function fixture() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ax-studio-mlx-'))
  temporaryDirectories.push(repoRoot)
  fs.writeFileSync(path.join(repoRoot, 'mlx.version'), '0.32.0\n')
  fs.mkdirSync(path.join(repoRoot, 'src-tauri'), { recursive: true })
  fs.writeFileSync(
    path.join(repoRoot, 'src-tauri', 'tauri.macos.conf.json'),
    JSON.stringify({ bundle: { macOS: { minimumSystemVersion: '15.0' } } }),
  )

  const packageRoot = path.join(repoRoot, 'wheel', 'mlx')
  const libraryDirectory = path.join(packageRoot, 'lib')
  fs.mkdirSync(libraryDirectory, { recursive: true })
  for (const fileName of runtimeFiles) {
    fs.writeFileSync(path.join(libraryDirectory, fileName), `fixture ${fileName}`)
  }
  return { repoRoot, packageRoot }
}

describe('MLX runtime preparation', () => {
  it('copies the pinned wheel runtime into Tauri bundle inputs', () => {
    const { repoRoot, packageRoot } = fixture()
    expect(readPinnedMlxVersion(repoRoot)).toBe('0.32.0')
    expect(readMinimumMacosVersion(repoRoot)).toBe('15.0')

    const result = prepareMlxRuntime({
      repoRoot,
      installedVersion: '0.32.0',
      packageRoot,
    })

    expect(result.files).toEqual(runtimeFiles)
    for (const fileName of runtimeFiles) {
      expect(
        fs.readFileSync(path.join(result.destinationDirectory, fileName), 'utf8'),
      ).toBe(`fixture ${fileName}`)
    }
  })

  it('rejects a wheel version that differs from the repository pin', () => {
    const { repoRoot, packageRoot } = fixture()
    expect(() =>
      prepareMlxRuntime({
        repoRoot,
        installedVersion: '0.31.2',
        packageRoot,
      }),
    ).toThrow(/does not match pinned 0\.32\.0/u)
  })

  it('requires wheel tags for the configured macOS deployment target', () => {
    const wheelPlatform = macosWheelPlatform('15.0')
    const probe = {
      installedVersion: '0.32.0',
      metalVersion: '0.32.0',
      mlxWheelTags: ['cp312-cp312-macosx_15_0_arm64'],
      metalWheelTags: ['py3-none-macosx_15_0_arm64'],
    }

    expect(wheelPlatform).toBe('macosx_15_0_arm64')
    expect(isTargetedMlxInstallation(probe, '0.32.0', wheelPlatform)).toBe(true)
    expect(
      isTargetedMlxInstallation(
        {
          ...probe,
          metalWheelTags: ['py3-none-macosx_26_0_arm64'],
        },
        '0.32.0',
        wheelPlatform,
      ),
    ).toBe(false)
  })

  it('reads the native macOS minimum from vtool output', () => {
    expect(
      parseMacosMinimumVersion(`
Load command 10
      cmd LC_BUILD_VERSION
  cmdsize 32
 platform MACOS
    minos 15.0
      sdk 26.5
`),
    ).toBe('15.0')
  })
})
