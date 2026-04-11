import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@ax-studio/tauri-plugin-llamacpp-api', () => ({
  getLocalInstalledBackendsInternal: vi.fn(async () => []),
  listSupportedBackendsFromRust: vi.fn(async (remote, local) => [...local, ...remote]),
  getSupportedFeaturesFromRust: vi.fn(async () => undefined),
  prioritizeBackends: vi.fn(async () => ({ backend_string: 'b1/cpu' })),
  checkBackendForUpdates: vi.fn(async () => ({
    update_needed: true,
    new_version: 'b2',
    target_backend: 'cpu',
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
  configureBackends,
  downloadBackend,
  fetchRemoteBackends,
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
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.storage.clear()
    mocks.existsSync.mockResolvedValue(false)
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

  it('returns an empty backend list when the GitHub request fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('boom'))
    await expect(fetchRemoteBackends()).resolves.toEqual([])
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
    expect(updateSetting).toHaveBeenCalledWith('version_backend', 'b1/cpu')
  })

  it('returns a safe no-update result when Rust update checks fail', async () => {
    vi.mocked(checkBackendForUpdates).mockRejectedValueOnce(new Error('bad'))
    await expect(checkForBackendUpdate('b1/cpu', [])).resolves.toEqual({
      updateNeeded: false,
      newVersion: '',
    })
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
