import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  emit: vi.fn(),
  getAppDataFolderPath: vi.fn(async () => '/app-data'),
  joinPath: vi.fn(async (parts: string[]) =>
    parts.join('/').replace(/\/+/g, '/')
  ),
  existsSync: vi.fn(async () => false),
  mkdir: vi.fn(async () => {}),
  rm: vi.fn(async () => {}),
  tauriFetchMock: vi.fn((...args: Parameters<typeof fetch>) =>
    (globalThis as any).fetch(...args)
  ),
}))

function ensureLocalStorage() {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => mocks.storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        mocks.storage.set(key, String(value))
      },
      removeItem: (key: string) => {
        mocks.storage.delete(key)
      },
      clear: () => {
        mocks.storage.clear()
      },
    },
  })
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

// Mock the Tauri HTTP plugin — the mock delegates to globalThis.fetch
// so existing test assertions on `fetch` still work.
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: mocks.tauriFetchMock,
}))

vi.mock('@ax-studio/tauri-plugin-llamacpp-api', () => ({
  getLocalInstalledBackendsInternal: vi.fn(async () => []),
  listSupportedBackendsFromRust: vi.fn(async (remote, local) => [...local, ...remote]),
  getSupportedFeaturesFromRust: vi.fn(async () => undefined),
  prioritizeBackends: vi.fn(async () => ({ backend_string: 'b1/ubuntu-x64' })),
  checkBackendForUpdates: vi.fn(async () => ({
    update_needed: true,
    new_version: 'b2',
    target_backend: 'ubuntu-x64',
  })),
  removeOldBackendVersions: vi.fn(async () => undefined),
  findLatestVersionForBackend: vi.fn(async () => null),
}))

vi.mock('@ax-studio/core', () => ({
  getAppDataFolderPath: mocks.getAppDataFolderPath,
  joinPath: mocks.joinPath,
  fs: {
    existsSync: mocks.existsSync,
    mkdir: mocks.mkdir,
    rm: mocks.rm,
  },
  events: {
    emit: mocks.emit,
  },
}))

;(globalThis as Record<string, unknown>).IS_WINDOWS = false
;(globalThis as Record<string, unknown>).IS_MACOS = false
;(globalThis as Record<string, unknown>).IS_LINUX = true

import {
  clearRemoteBackendsCacheForTests,
  checkForBackendUpdate,
  compareBackendVersions,
  configureBackends,
  downloadBackend,
  fetchRemoteBackends,
  getAxServingBinaryPath,
  installBackendFromFile,
} from './backend'
import { invoke } from '@tauri-apps/api/core'
import {
  checkBackendForUpdates,
  getLocalInstalledBackendsInternal,
  getSupportedFeaturesFromRust,
  listSupportedBackendsFromRust,
  prioritizeBackends,
} from '@ax-studio/tauri-plugin-llamacpp-api'

describe('llamacpp backend helpers', () => {
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>

  it('compares numeric backend versions naturally', () => {
    expect(compareBackendVersions('b10000', 'b9730')).toBeGreaterThan(0)
    expect(compareBackendVersions('v1.10.0', 'v1.9.9')).toBeGreaterThan(0)
    expect(compareBackendVersions('b9730', 'b9730')).toBe(0)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.storage.clear()
    mocks.existsSync.mockResolvedValue(false)
    vi.mocked(invoke).mockResolvedValue(undefined)
    clearRemoteBackendsCacheForTests()
    ensureLocalStorage()
    ;(globalThis as any).window = globalThis
    ;(globalThis as any).core = {
      extensionManager: {
        getByName: vi.fn((name: string) => {
          if (name === '@ax-studio/hardware-extension') {
            return {
              getHardwareInfo: vi.fn(async () => ({
                arch: 'x64',
                cpu_extensions: ['avx2'],
                gpus: [],
              })),
            }
          }
          if (name === '@ax-studio/download-extension') {
            return {
              downloadFile: vi.fn(async () => {}),
            }
          }
          return undefined
        }),
      },
    }
    ;(globalThis as any).fetch = vi.fn()
  })

  afterEach(() => {
    consoleDebugSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    consoleWarnSpy.mockRestore()
    vi.useRealTimers()
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: undefined,
    })
  })

  it('parses matching backend assets from GitHub releases', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          tag_name: 'b1',
          assets: [
            { name: 'llama-b1-bin-cpu.tar.gz' },
            { name: 'notes.txt' },
          ],
        },
      ],
    } as Response)

    await expect(fetchRemoteBackends()).resolves.toEqual([
      { version: 'b1', backend: 'cpu' },
    ])
  })

  it('uses bootstrap backends when the GitHub request fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('boom'))
    await expect(fetchRemoteBackends()).resolves.toEqual(
      expect.arrayContaining([
        { version: 'b9730', backend: 'win-cpu-x64' },
        { version: 'b9730', backend: 'macos-arm64' },
        { version: 'b9730', backend: 'ubuntu-x64' },
      ])
    )
  })

  it('falls back to browser fetch when Tauri HTTP backend discovery fails', async () => {
    mocks.tauriFetchMock.mockRejectedValueOnce(new Error('tauri http failed'))
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          tag_name: 'b1',
          assets: [{ name: 'llama-b1-bin-win-avx2-x64.zip' }],
        },
      ],
    } as Response)

    await expect(fetchRemoteBackends()).resolves.toEqual([
      { version: 'b1', backend: 'win-avx2-x64' },
    ])
    expect(mocks.tauriFetchMock).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reuses a cached backend release response to avoid repeated GitHub API calls', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          tag_name: 'b1',
          assets: [{ name: 'llama-b1-bin-cpu.tar.gz' }],
        },
      ],
    } as Response)

    await expect(fetchRemoteBackends()).resolves.toEqual([
      { version: 'b1', backend: 'cpu' },
    ])
    await expect(fetchRemoteBackends()).resolves.toEqual([
      { version: 'b1', backend: 'cpu' },
    ])

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('installs a backend archive using linear filename parsing', async () => {
    mocks.existsSync.mockImplementation(async (path: string) => {
      return path.endsWith('/backends/b123/cpu/llama-server')
    })

    await installBackendFromFile('/tmp/llama-b123-bin-cpu.tar.gz')

    expect(mocks.mkdir).toHaveBeenCalledWith(
      '/app-data/llamacpp/backends/b123/cpu'
    )
    expect(invoke).toHaveBeenCalledWith('decompress', {
      path: '/tmp/llama-b123-bin-cpu.tar.gz',
      outputDir: '/app-data/llamacpp/backends/b123/cpu',
    })
  })

  it('rejects malformed backend archive filenames', async () => {
    await expect(
      installBackendFromFile('/tmp/llama-b123-cpu.tar.gz')
    ).rejects.toThrow('Invalid backend filename')
  })

  it('serializes duplicate configureBackends calls onto one in-flight promise', async () => {
    mocks.existsSync.mockImplementation(async (path: string) => {
      return path.includes('/backends') || path.endsWith('llama-server')
    })
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response)

    const updateSetting = vi.fn()
    const first = configureBackends('', true, updateSetting)
    const second = configureBackends('', true, updateSetting)

    await Promise.all([first, second])

    expect(getSupportedFeaturesFromRust).toHaveBeenCalledTimes(1)
    expect(listSupportedBackendsFromRust).toHaveBeenCalledTimes(1)
    expect(prioritizeBackends).toHaveBeenCalledTimes(1)
    expect(updateSetting).toHaveBeenCalledWith('version_backend', 'b1/ubuntu-x64')
  })

  it('selects a Windows bootstrap backend when release discovery and Rust ranking fail', async () => {
    ;(globalThis as Record<string, unknown>).IS_WINDOWS = true
    ;(globalThis as Record<string, unknown>).IS_LINUX = false
    vi.mocked(fetch).mockRejectedValue(new Error('blocked'))
    vi.mocked(prioritizeBackends).mockResolvedValueOnce(null as never)
    mocks.existsSync.mockImplementation(async (path: string) => {
      return path.includes('/backends') || path.endsWith('llama-server.exe')
    })

    const updateSetting = vi.fn()
    await configureBackends('', false, updateSetting)

    expect(updateSetting).toHaveBeenCalledWith(
      'version_backend',
      'b9730/win-cpu-x64'
    )

    ;(globalThis as Record<string, unknown>).IS_WINDOWS = false
    ;(globalThis as Record<string, unknown>).IS_LINUX = true
  })

  it('selects a bootstrap backend when remote discovery returns no usable assets', async () => {
    ;(globalThis as Record<string, unknown>).IS_WINDOWS = true
    ;(globalThis as Record<string, unknown>).IS_LINUX = false
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [{ tag_name: 'b1', assets: [{ name: 'notes.txt' }] }],
    } as Response)
    vi.mocked(prioritizeBackends).mockResolvedValueOnce(null as never)
    mocks.existsSync.mockImplementation(async (path: string) => {
      return path.includes('/backends') || path.endsWith('llama-server.exe')
    })

    const updateSetting = vi.fn()
    await configureBackends('', false, updateSetting)

    expect(updateSetting).toHaveBeenCalledWith(
      'version_backend',
      'b9730/win-cpu-x64'
    )

    ;(globalThis as Record<string, unknown>).IS_WINDOWS = false
    ;(globalThis as Record<string, unknown>).IS_LINUX = true
  })

  it('uses runtime Windows platform when build constants were produced on macOS', async () => {
    ;(globalThis as Record<string, unknown>).IS_WINDOWS = false
    ;(globalThis as Record<string, unknown>).IS_MACOS = true
    ;(globalThis as Record<string, unknown>).IS_LINUX = false
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { platform: 'Win32', userAgent: 'Windows NT 10.0' },
    })
    vi.mocked(fetch).mockRejectedValue(new Error('blocked'))
    vi.mocked(prioritizeBackends).mockResolvedValueOnce(null as never)
    mocks.existsSync.mockImplementation(async (path: string) => {
      return path.includes('/backends') || path.endsWith('llama-server.exe')
    })

    const updateSetting = vi.fn()
    await configureBackends('', false, updateSetting)

    expect(updateSetting).toHaveBeenCalledWith(
      'version_backend',
      'b9730/win-cpu-x64'
    )

    ;(globalThis as Record<string, unknown>).IS_MACOS = false
    ;(globalThis as Record<string, unknown>).IS_LINUX = true
  })

  it('clears a saved macOS backend when running on Windows', async () => {
    ;(globalThis as Record<string, unknown>).IS_WINDOWS = false
    ;(globalThis as Record<string, unknown>).IS_MACOS = true
    ;(globalThis as Record<string, unknown>).IS_LINUX = false
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { platform: 'Win32', userAgent: 'Windows NT 10.0' },
    })
    vi.mocked(fetch).mockRejectedValue(new Error('blocked'))
    vi.mocked(prioritizeBackends).mockResolvedValueOnce(null as never)
    mocks.existsSync.mockImplementation(async (path: string) => {
      return path.includes('/backends') || path.endsWith('llama-server.exe')
    })

    const updateSetting = vi.fn()
    await configureBackends('b9730/macos-arm64', false, updateSetting)

    expect(updateSetting).toHaveBeenNthCalledWith(1, 'version_backend', '')
    expect(updateSetting).toHaveBeenCalledWith(
      'version_backend',
      'b9730/win-cpu-x64'
    )

    ;(globalThis as Record<string, unknown>).IS_MACOS = false
    ;(globalThis as Record<string, unknown>).IS_LINUX = true
  })

  it('uses native hardware arch when macOS WebView reports Apple Silicon as MacIntel', async () => {
    ;(globalThis as Record<string, unknown>).IS_WINDOWS = false
    ;(globalThis as Record<string, unknown>).IS_MACOS = true
    ;(globalThis as Record<string, unknown>).IS_LINUX = false
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { platform: 'MacIntel', userAgent: 'Macintosh; Intel Mac OS X' },
    })
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'plugin:hardware|get_system_info') {
        return {
          os_type: 'macos',
          cpu: {
            arch: 'arm64',
            extensions: [],
          },
          gpus: [],
        }
      }
      return undefined
    })
    vi.mocked(fetch).mockRejectedValue(new Error('blocked'))
    vi.mocked(prioritizeBackends).mockResolvedValueOnce(null as never)
    mocks.existsSync.mockImplementation(async (path: string) => {
      return path.includes('/backends') || path.endsWith('llama-server')
    })

    const updateSetting = vi.fn()
    await configureBackends('b9730/macos-x64', false, updateSetting)

    expect(updateSetting).toHaveBeenNthCalledWith(1, 'version_backend', '')
    expect(updateSetting).toHaveBeenCalledWith(
      'version_backend',
      'b9730/macos-arm64'
    )

    ;(globalThis as Record<string, unknown>).IS_MACOS = false
    ;(globalThis as Record<string, unknown>).IS_LINUX = true
  })

  it('clears a saved Windows ARM64 backend when running on AMD64 Windows', async () => {
    ;(globalThis as Record<string, unknown>).IS_WINDOWS = false
    ;(globalThis as Record<string, unknown>).IS_MACOS = true
    ;(globalThis as Record<string, unknown>).IS_LINUX = false
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { platform: 'Win32', userAgent: 'Windows NT 10.0; Win64; x64' },
    })
    vi.mocked(fetch).mockRejectedValue(new Error('blocked'))
    vi.mocked(prioritizeBackends).mockResolvedValueOnce(null as never)
    mocks.existsSync.mockImplementation(async (path: string) => {
      return path.includes('/backends') || path.endsWith('llama-server.exe')
    })

    const updateSetting = vi.fn()
    await configureBackends('b9730/win-cpu-arm64', false, updateSetting)

    expect(updateSetting).toHaveBeenNthCalledWith(1, 'version_backend', '')
    expect(updateSetting).toHaveBeenCalledWith(
      'version_backend',
      'b9730/win-cpu-x64'
    )

    ;(globalThis as Record<string, unknown>).IS_MACOS = false
    ;(globalThis as Record<string, unknown>).IS_LINUX = true
  })

  it('ignores an incompatible Rust-ranked backend before falling back by OS', async () => {
    ;(globalThis as Record<string, unknown>).IS_WINDOWS = false
    ;(globalThis as Record<string, unknown>).IS_MACOS = true
    ;(globalThis as Record<string, unknown>).IS_LINUX = false
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { platform: 'Win32', userAgent: 'Windows NT 10.0' },
    })
    vi.mocked(fetch).mockRejectedValue(new Error('blocked'))
    vi.mocked(prioritizeBackends).mockResolvedValueOnce({
      backend_string: 'b9730/macos-arm64',
      version: 'b9730',
      backend_type: 'macos-arm64',
    })
    mocks.existsSync.mockImplementation(async (path: string) => {
      return path.includes('/backends') || path.endsWith('llama-server.exe')
    })

    const updateSetting = vi.fn()
    await configureBackends('', false, updateSetting)

    expect(updateSetting).toHaveBeenCalledWith(
      'version_backend',
      'b9730/win-cpu-x64'
    )

    ;(globalThis as Record<string, unknown>).IS_MACOS = false
    ;(globalThis as Record<string, unknown>).IS_LINUX = true
  })

  it('ignores a Rust-ranked Windows ARM64 backend on AMD64 Windows', async () => {
    ;(globalThis as Record<string, unknown>).IS_WINDOWS = false
    ;(globalThis as Record<string, unknown>).IS_MACOS = true
    ;(globalThis as Record<string, unknown>).IS_LINUX = false
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { platform: 'Win32', userAgent: 'Windows NT 10.0; Win64; x64' },
    })
    vi.mocked(fetch).mockRejectedValue(new Error('blocked'))
    vi.mocked(prioritizeBackends).mockResolvedValueOnce({
      backend_string: 'b9730/win-cpu-arm64',
      version: 'b9730',
      backend_type: 'win-cpu-arm64',
    })
    mocks.existsSync.mockImplementation(async (path: string) => {
      return path.includes('/backends') || path.endsWith('llama-server.exe')
    })

    const updateSetting = vi.fn()
    await configureBackends('', false, updateSetting)

    expect(updateSetting).toHaveBeenCalledWith(
      'version_backend',
      'b9730/win-cpu-x64'
    )

    ;(globalThis as Record<string, unknown>).IS_MACOS = false
    ;(globalThis as Record<string, unknown>).IS_LINUX = true
  })

  it('returns a safe no-update result when Rust update checks fail', async () => {
    vi.mocked(checkBackendForUpdates).mockRejectedValueOnce(new Error('bad'))
    await expect(checkForBackendUpdate('b1/cpu', [])).resolves.toEqual({
      updateNeeded: false,
      newVersion: '',
    })
  })

  it('uses an existing app-managed ax-serving binary when present', async () => {
    mocks.existsSync.mockImplementation(async (path: string) =>
      path === '/app-data/ax-serving/ax-serving'
    )

    await expect(getAxServingBinaryPath()).resolves.toBe(
      '/app-data/ax-serving/ax-serving'
    )

    expect(mocks.mkdir).not.toHaveBeenCalled()
  })

  it('uses an existing system ax-serving binary before falling back to PATH', async () => {
    mocks.existsSync.mockImplementation(async (path: string) =>
      path === '/opt/homebrew/bin/ax-serving'
    )

    await expect(getAxServingBinaryPath()).resolves.toBe(
      '/opt/homebrew/bin/ax-serving'
    )

    expect(mocks.mkdir).not.toHaveBeenCalled()
  })

  it('falls back to ax-serving on PATH when known paths are missing', async () => {
    mocks.existsSync.mockImplementation(async (path: string) => {
      if (path.startsWith('/usr/local') || path.startsWith('/opt/homebrew')) {
        throw new Error('outside app data')
      }
      return false
    })

    await expect(getAxServingBinaryPath()).resolves.toBe('ax-serving')

    expect(mocks.mkdir).not.toHaveBeenCalled()
  })

  it('retries backend downloads with exponential backoff before succeeding', async () => {
    vi.useFakeTimers()
    mocks.existsSync.mockImplementation(async (path: string) => path.endsWith('llama-server'))
    const downloadFile = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(undefined)

    ;(globalThis as any).core.extensionManager.getByName = vi.fn((name: string) => {
      if (name === '@ax-studio/download-extension') {
        return { downloadFile }
      }
      if (name === '@ax-studio/hardware-extension') {
        return {
          getHardwareInfo: vi.fn(async () => ({
            arch: 'x64',
            cpu_extensions: ['avx2'],
            gpus: [],
          })),
        }
      }
      return undefined
    })
    vi.mocked(invoke).mockResolvedValue(undefined)

    const promise = downloadBackend('b1', 'cpu')
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toBeUndefined()

    expect(downloadFile).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })
})
