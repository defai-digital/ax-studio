import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import { execFile } from 'node:child_process'
vi.mock('node:path', async () => ({ default: (await vi.importActual('node:path')).posix }))
vi.mock('node:child_process', () => ({ execFile: vi.fn(), execFileSync: vi.fn() }))
vi.mock('../../electron/src/state.ts', () => ({ getAppDataFolderPath: () => '/data' }))
import { validateBinaryPath, trustedBinaryRoots } from '../../electron/src/llamacpp/path.ts'
afterEach(() => { vi.restoreAllMocks(); vi.resetModules() })
describe('Homebrew canonical backend trust', () => {
  it.each(['/opt/homebrew', '/usr/local'])('accepts bin symlinks into %s/Cellar only', (prefix) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const alias = prefix + '/bin/llama-server'
    let target = prefix + '/Cellar/llama.cpp/1/bin/llama-server'
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true })
    vi.spyOn(fs, 'realpathSync').mockImplementation((p) => p === alias ? target : p)
    expect(validateBinaryPath(alias, trustedBinaryRoots(), ['llama-server'])).toBe(target)
    target = '/unrelated/llama-server'
    expect(() => validateBinaryPath(alias, trustedBinaryRoots(), ['llama-server'])).toThrow('trusted install')
    target = prefix + '/Cellar/llama.cpp/1/bin/evil'
    expect(() => validateBinaryPath(alias, trustedBinaryRoots(), ['llama-server'])).toThrow('name is not allowed')
  })
  it('does not expand custom roots or trust an escaping Cellar symlink', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'statSync').mockReturnValue({ isFile: () => true })
    vi.spyOn(fs, 'realpathSync').mockImplementation((p) => p === '/opt/homebrew/bin/llama-server' ? '/outside/llama-server' : p === '/opt/homebrew/Cellar' ? '/outside' : p)
    expect(() => validateBinaryPath('/opt/homebrew/bin/llama-server', trustedBinaryRoots(), ['llama-server'])).toThrow('trusted install')
    expect(validateBinaryPath('/data/llamacpp/backends/llama-server', trustedBinaryRoots(), ['llama-server'])).toBe('/data/llamacpp/backends/llama-server')
  })
})
it('does not invoke Vulkan on macOS', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
  execFile.mockImplementation((_cmd, _args, _options, callback) => callback(new Error('not installed'), ''))
  const { getSystemInfo } = await import('../../electron/src/hardware/index.ts')
  expect(await getSystemInfo()).toHaveProperty('cpu')
  expect(execFile.mock.calls.some(([cmd]) => cmd === 'vulkaninfo')).toBe(false)
})
