import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { crc32 } from 'node:zlib'
import { execFileSync } from 'node:child_process'
import { extractZip } from '../../electron/src/zip.ts'
import { findSystemExecutable } from '../../electron/src/executable-search.ts'

vi.mock('../../electron/src/ax-engine/paths.ts', () => ({
  managedBinaryPath: () => '/managed/ax-engine',
}))
vi.mock('electron', () => ({ app: {} }))
import { resolveAxEngineBinary } from '../../electron/src/ax-engine/dependency.ts'
import { resolveAxEngineBenchBinary } from '../../electron/src/commands/mlx.ts'

const actualPlatform = process.platform
const temporaryRoots = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const root of temporaryRoots.splice(0))
    await fsp.rm(root, { recursive: true, force: true })
})

describe('engine executable discovery', () => {
  beforeEach(() => {
    vi.stubEnv('PATH', '/usr/bin')
    vi.stubEnv('AX_ENGINE_BIN', '')
    vi.stubEnv('AX_ENGINE_BENCH_BIN', '')
  })
  function installed(platform, paths) {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
    const normalized = new Set(paths.map((p) => path.normalize(p)))
    vi.spyOn(fs, 'accessSync').mockImplementation((p) => {
      if (!normalized.has(path.normalize(p))) throw new Error('ENOENT')
    })
    vi.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true })
  }
  it.each(['/opt/homebrew/bin', '/usr/local/bin'])(
    'discovers engine and bench with Finder PATH via %s',
    (dir) => {
      installed('darwin', [`${dir}/ax-engine`, `${dir}/ax-engine-bench`])
      expect(resolveAxEngineBinary()).toEqual({
        path: path.join(dir, 'ax-engine'),
        source: 'path',
      })
      expect(resolveAxEngineBenchBinary()).toBe(
        path.join(dir, 'ax-engine-bench')
      )
    }
  )
  it('finds a standalone Homebrew bench even without an engine binary', () => {
    installed('darwin', ['/opt/homebrew/bin/ax-engine-bench'])
    expect(resolveAxEngineBenchBinary()).toBe(
      path.join('/opt/homebrew/bin', 'ax-engine-bench')
    )
  })
  it('keeps PATH ahead of Homebrew and preserves explicit override precedence', () => {
    installed('darwin', [
      '/usr/bin/ax-engine',
      '/opt/homebrew/bin/ax-engine',
      '/override',
      '/env',
    ])
    expect(resolveAxEngineBinary().path).toBe(
      path.join('/usr/bin', 'ax-engine')
    )
    vi.stubEnv('AX_ENGINE_BIN', '/env')
    expect(resolveAxEngineBinary()).toEqual({ path: '/env', source: 'env' })
    expect(resolveAxEngineBinary('/override')).toEqual({
      path: '/override',
      source: 'override',
    })
    expect(resolveAxEngineBinary('/missing')).toBeNull()
    vi.stubEnv('AX_ENGINE_BIN', '/missing')
    expect(resolveAxEngineBinary()).toBeNull()
    vi.stubEnv('AX_ENGINE_BENCH_BIN', '/missing')
    expect(resolveAxEngineBenchBinary()).toBeNull()
  })
  it.each(['win32', 'linux'])(
    'does not search Homebrew on %s and retains managed fallback',
    (platform) => {
      installed(platform, ['/opt/homebrew/bin/ax-engine', '/managed/ax-engine'])
      expect(findSystemExecutable('ax-engine')).toBeNull()
      expect(resolveAxEngineBinary()).toEqual({
        path: '/managed/ax-engine',
        source: 'managed',
      })
    }
  )
  it('retains native Windows PATH lookup', () => {
    installed('win32', ['C:/Tools/ax-engine'])
    vi.stubEnv('PATH', ['C:/Missing', 'C:/Tools'].join(path.delimiter))
    expect(resolveAxEngineBinary().path).toBe(
      path.join('C:/Tools', 'ax-engine')
    )
  })
})

// A real stored ZIP with Unix central-directory attributes; no ZIP-writing dependency.
function zip(entries) {
  const local = [],
    central = []
  let offset = 0
  for (const {
    name,
    mode = 0o100755,
    content = '#!/bin/sh\nprintf zip-ok',
    unix = true,
  } of entries) {
    const filename = Buffer.from(name),
      body = Buffer.from(content)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50)
    header.writeUInt16LE(20, 4)
    header.writeUInt32LE(crc32(body), 14)
    header.writeUInt32LE(body.length, 18)
    header.writeUInt32LE(body.length, 22)
    header.writeUInt16LE(filename.length, 26)
    local.push(header, filename, body)
    const record = Buffer.alloc(46)
    record.writeUInt32LE(0x02014b50)
    record.writeUInt16LE(unix ? 0x314 : 20, 4)
    record.writeUInt16LE(20, 6)
    record.writeUInt32LE(crc32(body), 16)
    record.writeUInt32LE(body.length, 20)
    record.writeUInt32LE(body.length, 24)
    record.writeUInt16LE(filename.length, 28)
    record.writeUInt32LE((mode << 16) >>> 0, 38)
    record.writeUInt32LE(offset, 42)
    central.push(record, filename)
    offset += header.length + filename.length + body.length
  }
  const end = Buffer.alloc(22),
    directory = Buffer.concat(central)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}

async function archiveFixture(entries) {
  // macOS /var is commonly a symlink to /private/var.
  const root = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), 'ax-zip-compat-'))
  )
  temporaryRoots.push(root)
  const archive = path.join(root, 'backend.zip'),
    output = path.join(root, 'output')
  await fsp.writeFile(archive, zip(entries))
  return { root, archive, output }
}

describe('ZIP backend permissions', () => {
  it('restores executable bits on macOS, strips special bits, and keeps data nonexecutable', async () => {
    const { archive, output } = await archiveFixture([
      { name: 'bin/llama-server', mode: 0o104755 },
      { name: 'data.json', mode: 0o100644, content: '{}' },
    ])
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const chmod = vi.spyOn(fsp, 'chmod')
    await extractZip(archive, output)
    expect(chmod).toHaveBeenCalledWith(
      path.join(output, 'bin/llama-server'),
      0o755
    )
    expect(chmod).toHaveBeenCalledWith(path.join(output, 'data.json'), 0o644)
    expect(await fsp.readFile(path.join(output, 'data.json'), 'utf8')).toBe(
      '{}'
    )
    if (actualPlatform !== 'win32') {
      expect(
        (await fsp.stat(path.join(output, 'bin/llama-server'))).mode & 0o777
      ).toBe(0o755)
      expect(
        execFileSync(path.join(output, 'bin/llama-server'), {
          encoding: 'utf8',
        })
      ).toBe('zip-ok')
    }
  })
  it('extracts Windows archives without invoking chmod', async () => {
    const { archive, output } = await archiveFixture([
      { name: 'bin/llama-server.exe', unix: false, content: 'fixture' },
    ])
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const chmod = vi.spyOn(fsp, 'chmod')
    await extractZip(archive, output)
    expect(
      await fsp.readFile(path.join(output, 'bin/llama-server.exe'), 'utf8')
    ).toBe('fixture')
    expect(chmod).not.toHaveBeenCalled()
  })
  it('does not reinterpret DOS metadata as Unix permissions on macOS', async () => {
    const { archive, output } = await archiveFixture([
      { name: 'data.txt', unix: false },
    ])
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const chmod = vi.spyOn(fsp, 'chmod')
    await extractZip(archive, output)
    expect(chmod).not.toHaveBeenCalled()
  })
  it.each([
    '../outside/llama-server',
    '..\\outside\\llama-server',
    '/absolute',
    'C:/absolute',
    'data:stream',
  ])('rejects unsafe archive path %s', async (name) => {
    const { archive, output } = await archiveFixture([{ name }])
    await expect(extractZip(archive, output)).rejects.toThrow('unsafe ZIP path')
    expect(await fsp.readdir(output)).toEqual([])
  })
  it('rejects archive symlinks and pre-existing directory junctions', async () => {
    const first = await archiveFixture([
      { name: 'link', mode: 0o120777, content: '../outside' },
    ])
    await expect(extractZip(first.archive, first.output)).rejects.toThrow(
      'special file'
    )
    const { root, archive, output } = await archiveFixture([
      { name: 'bin/llama-server' },
    ])
    const outside = path.join(root, 'outside')
    await fsp.mkdir(outside)
    await fsp.mkdir(output)
    await fsp.symlink(outside, path.join(output, 'bin'), 'junction')
    await expect(extractZip(archive, output)).rejects.toThrow('symbolic link')
    expect(await fsp.readdir(outside)).toEqual([])
  })
  it('rejects a corrupt archive', async () => {
    const { archive, output } = await archiveFixture([])
    await fsp.writeFile(archive, 'not a zip')
    await expect(extractZip(archive, output)).rejects.toThrow()
  })
})

describe('release signing configuration', () => {
  const require = createRequire(
    new URL('../../electron/package.json', import.meta.url)
  )
  const { parse } = require('yaml')
  const workflow = parse(
    fs.readFileSync(
      new URL(
        '../../.github/workflows/ax-studio-electron-build.yml',
        import.meta.url
      ),
      'utf8'
    )
  )
  it('passes Apple secrets through the electron-builder signing contract and requires signing when configured', () => {
    const steps = workflow.jobs['build-macos'].steps
    const build = steps.find(
      (step) => step.name === 'Build and package (macOS)'
    )
    expect(build.env.CSC_LINK).toBe('${{ secrets.APPLE_CERTIFICATE }}')
    expect(build.env.CSC_KEY_PASSWORD).toBe(
      '${{ secrets.APPLE_CERTIFICATE_PASSWORD }}'
    )
    expect(build.env.CSC_NAME).toBe('${{ secrets.APPLE_SIGNING_IDENTITY }}')
    expect(build.run).toContain('extra_args+=("$SIGNING_ARGS")')
    const setup = steps.find(
      (step) => step.name === 'Configure signing and notarization'
    )
    expect(setup.run).toContain('SIGNING_ARGS=-c.forceCodeSigning=true')
    expect(setup.run).toContain('CSC_IDENTITY_AUTO_DISCOVERY=false')
    expect(setup.run).toContain('"$signed" -eq 1 && "$notary" -eq 1')
  })
  it('retains Windows Authenticode credentials and Windows package invocation', () => {
    const build = workflow.jobs['build-windows'].steps.find(
      (step) => step.name === 'Build and package (Windows)'
    )
    expect(build.env.CSC_LINK).toBe('${{ secrets.CSC_LINK }}')
    expect(build.env.CSC_KEY_PASSWORD).toBe('${{ secrets.CSC_KEY_PASSWORD }}')
    expect(build.run).toContain('node scripts/dist-electron.mjs --win')
    expect(build.run).not.toContain('SIGNING_ARGS')
  })
})
