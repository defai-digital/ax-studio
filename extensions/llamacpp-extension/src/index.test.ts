import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'

const mocks = vi.hoisted(() => {
  const storage = new Map<string, string>()
  const fsState = new Map<string, string>()
  const dirState = new Set<string>()

  return {
    storage,
    fsState,
    dirState,
    registerEngine: vi.fn(),
    registerSettings: vi.fn(),
    getSettings: vi.fn(async () => []),
    getSetting: vi.fn(async (_key: string, defaultValue: unknown) => defaultValue),
    updateSettings: vi.fn(async () => {}),
    showToast: vi.fn(),
    emit: vi.fn(),
    joinPath: vi.fn(async (parts: string[]) =>
      parts.join('/').replace(/\/+/g, '/')
    ),
    getAppDataFolderPath: vi.fn(async () => '/app-data'),
  }
})

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

vi.mock('./backend', () => ({
  configureBackends: vi.fn(async () => {}),
  downloadBackend: vi.fn(async () => {}),
  updateBackend: vi.fn(async () => ({ wasUpdated: false, newBackend: '' })),
  installBackendFromFile: vi.fn(async () => {}),
  getBackendExePath: vi.fn(async () => '/backend/llama-server'),
  getAxServingBinaryPath: vi.fn(async () => '/backend/ax-serving'),
  checkForBackendUpdate: vi.fn(async () => ({
    updateNeeded: false,
    newVersion: '',
  })),
  fetchRemoteBackends: vi.fn(async () => []),
}))

vi.mock('./provider-sync', () => ({
  decideLocalProviderSync: vi.fn(() => null),
}))

vi.mock('./util', async () => {
  const actual = await vi.importActual<typeof import('./util')>('./util')
  return {
    ...actual,
    getProxyConfig: vi.fn(() => null),
    buildProxyArg: vi.fn(() => null),
  }
})

vi.mock('@ax-studio/tauri-plugin-llamacpp-api', () => ({
  loadLlamaModel: vi.fn(),
  unloadLlamaModel: vi.fn(),
  startAxServing: vi.fn(),
  getDevices: vi.fn(async () => []),
  generateApiKey: vi.fn(async () => 'key'),
  isProcessRunning: vi.fn(async () => false),
  findSessionByModel: vi.fn(async () => null),
  getLoadedModels: vi.fn(async () => []),
  getRandomPort: vi.fn(async () => 1234),
  readGgufMetadata: vi.fn(async () => ({ metadata: {} })),
  getModelSize: vi.fn(async () => 123),
  isModelSupported: vi.fn(async () => true),
  normalizeLlamacppConfig: vi.fn((config) => config),
}))

vi.mock('@ax-studio/core', () => ({
  AIEngine: class {
    name = '@ax-studio/llamacpp-extension'
    url = ''
    active = false
    description = ''
    version = ''
    constructor() {}
    registerEngine = mocks.registerEngine
    registerSettings = mocks.registerSettings
    getSettings = mocks.getSettings
    getSetting = mocks.getSetting
    updateSettings = mocks.updateSettings
  },
  getAppDataFolderPath: mocks.getAppDataFolderPath,
  joinPath: mocks.joinPath,
  fs: {
    existsSync: vi.fn(
      async (path: string) =>
        mocks.dirState.has(path) || mocks.fsState.has(path)
    ),
    mkdir: vi.fn(async (path: string) => {
      mocks.dirState.add(path)
    }),
    writeFileSync: vi.fn(async (path: string, content: string) => {
      mocks.fsState.set(path, content)
    }),
    readFileSync: vi.fn(async (path: string) => {
      if (!mocks.fsState.has(path)) throw new Error(`Missing file: ${path}`)
      return mocks.fsState.get(path)
    }),
    fileStat: vi.fn(async (path: string) => {
      if (mocks.dirState.has(path)) return { isDirectory: true, size: 0 }
      if (mocks.fsState.has(path)) {
        return {
          isDirectory: false,
          size: mocks.fsState.get(path)?.length ?? 0,
        }
      }
      return null
    }),
    rm: vi.fn(async (path: string) => {
      mocks.fsState.delete(path)
      mocks.dirState.delete(path)
    }),
    copyFile: vi.fn(async (from: string, to: string) => {
      const value = mocks.fsState.get(from)
      if (value === undefined) throw new Error(`Missing file: ${from}`)
      mocks.fsState.set(to, value)
    }),
    readdirSync: vi.fn(async () => []),
  },
  events: { emit: mocks.emit },
  AppEvent: {
    onModelImported: 'onModelImported',
  },
  DownloadEvent: {
    onFileDownloadStarted: 'onFileDownloadStarted',
    onFileDownloadError: 'onFileDownloadError',
    onFileDownloadSuccess: 'onFileDownloadSuccess',
    onModelValidationStarted: 'onModelValidationStarted',
    onModelValidationFailed: 'onModelValidationFailed',
    onFileDownloadAndVerificationSuccess: 'onFileDownloadAndVerificationSuccess',
    onFileDownloadUpdate: 'onFileDownloadUpdate',
  },
  ModelEvent: {
    OnModelInit: 'OnModelInit',
    OnModelFail: 'OnModelFail',
    OnModelReady: 'OnModelReady',
    OnModelStop: 'OnModelStop',
    OnModelStopped: 'OnModelStopped',
  },
  showToast: mocks.showToast,
}))

;(globalThis as Record<string, unknown>).SETTINGS = []
;(globalThis as Record<string, unknown>).ENGINE = 'llamacpp'
;(globalThis as Record<string, unknown>).IS_WINDOWS = false
;(globalThis as Record<string, unknown>).IS_MACOS = false
;(globalThis as Record<string, unknown>).IS_LINUX = true

import AxStudioLlamacppExtension from './index'
import { configureBackends } from './backend'

describe('AxStudioLlamacppExtension', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.storage.clear()
    mocks.fsState.clear()
    mocks.dirState.clear()
    mocks.dirState.add('/app-data')
    mocks.dirState.add('/app-data/llamacpp')
    mocks.dirState.add('/app-data/llamacpp/models')
    ensureLocalStorage()
    ;(globalThis as any).window = globalThis
    ;(globalThis as any).core = {
      extensionManager: {
        getByName: vi.fn(() => undefined),
      },
      api: {},
    }
    vi.mocked(invoke).mockImplementation(async (_command: string, args?: unknown) => {
      const path = (args as { path?: string } | undefined)?.path
      return path ?? ''
    })
  })

  it('shows a toast when background backend configuration fails during onLoad', async () => {
    vi.mocked(configureBackends).mockRejectedValueOnce(new Error('network down'))
    const extension = new AxStudioLlamacppExtension('', '')

    await extension.onLoad()
    await Promise.resolve()

    expect(mocks.registerSettings).toHaveBeenCalledWith([])
    expect(mocks.showToast).toHaveBeenCalledWith(
      'llama.cpp backend setup failed',
      'Backend configuration failed: network down'
    )
    expect(mocks.registerEngine).toHaveBeenCalled()
  })

  it('updates local fields and config in one setting pass', () => {
    const extension = new AxStudioLlamacppExtension('', '')

    extension.onSettingUpdate('auto_unload', false)
    extension.onSettingUpdate('timeout', '42')
    extension.onSettingUpdate('grammar_file', '/tmp/grammar.gbnf')

    expect((extension as any).autoUnload).toBe(false)
    expect((extension as any).timeout).toBe(42)
    expect((extension as any).grammarFile).toBe('/tmp/grammar.gbnf')
    expect((extension as any).config.auto_unload).toBe(false)
    expect((extension as any).config.timeout).toBe(42)
  })

  it('rejects invalid model identifiers', () => {
    const extension = new AxStudioLlamacppExtension('', '')
    expect(() => (extension as any)._validateModelId('../escape')).toThrow(
      'Invalid model ID'
    )
  })

  it('uses a shared helper to reject paths outside the models directory', async () => {
    const extension = new AxStudioLlamacppExtension('', '')

    await expect(
      (extension as any)._validatePathWithinModelsDir(
        '/app-data/elsewhere/model.gguf',
        'Model'
      )
    ).rejects.toThrow('Model path traversal detected')

    await expect(
      (extension as any)._validatePathWithinModelsDir(
        '/app-data/llamacpp/models/org/model.gguf',
        'Model'
      )
    ).resolves.toBeUndefined()
  })

  it('rejects symlink-style escapes after filesystem canonicalization', async () => {
    const extension = new AxStudioLlamacppExtension('', '')
    mocks.fsState.set('/app-data/llamacpp/models/symlink/model.gguf', 'linked')

    vi.mocked(invoke).mockImplementation(async (_command: string, args?: unknown) => {
      const path = (args as { path?: string } | undefined)?.path ?? ''
      if (path === '/app-data/llamacpp/models') return '/app-data/llamacpp/models'
      if (path === '/app-data/llamacpp/models/symlink/model.gguf') {
        return '/private/outside/model.gguf'
      }
      return path
    })

    await expect(
      (extension as any)._validatePathWithinModelsDir(
        '/app-data/llamacpp/models/symlink/model.gguf',
        'Model'
      )
    ).rejects.toThrow('Model path traversal detected')
  })

  it('canonicalizes local import paths before copy operations', () => {
    const extension = new AxStudioLlamacppExtension('', '')

    expect(
      (extension as any)._canonicalizeImportSourcePath(
        '/models/../models/model.gguf',
        'Model'
      )
    ).toBe('/models/model.gguf')

    expect(
      (extension as any)._canonicalizeImportSourcePath(
        'C:\\models\\..\\models\\model.gguf',
        'Model'
      )
    ).toBe('C:\\models\\model.gguf')

    expect(() =>
      (extension as any)._canonicalizeImportSourcePath(
        '../../etc/passwd',
        'Model'
      )
    ).toThrow('Model path must be absolute')

    expect(() =>
      (extension as any)._canonicalizeImportSourcePath('/tmp/passwd', 'Model')
    ).toThrow('.gguf')
  })

  it('round-trips model config through model.yml helpers', async () => {
    const extension = new AxStudioLlamacppExtension('', '')

    await (extension as any)._writeModelConfig('org/model', {
      model_path: 'llamacpp/models/org/model/model.gguf',
      mmproj_path: 'llamacpp/models/org/model/mmproj.gguf',
      name: 'org/model',
      size_bytes: 123,
      embedding: true,
      sha256: 'abc',
      mmproj_sha256: 'def',
    })

    const config = await (extension as any)._readModelConfig('org/model')
    expect(config).toEqual({
      model_path: 'llamacpp/models/org/model/model.gguf',
      mmproj_path: 'llamacpp/models/org/model/mmproj.gguf',
      name: 'org/model',
      size_bytes: 123,
      embedding: true,
      sha256: 'abc',
      mmproj_sha256: 'def',
    })
  })

  it('fails import when the download extension is unavailable for remote files', async () => {
    const extension = new AxStudioLlamacppExtension('', '')

    await expect(
      extension.import('org/model', {
        modelPath: 'https://example.com/model.gguf',
      })
    ).rejects.toThrow('Download extension not available')
  })

  it('canonicalizes local import sources with the backend before copy operations', async () => {
    const extension = new AxStudioLlamacppExtension('', '')
    mocks.fsState.set('/private/tmp/model.gguf', 'gguf-binary')

    vi.mocked(invoke).mockImplementation(async (_command: string, args?: unknown) => {
      const path = (args as { path?: string } | undefined)?.path ?? ''
      if (path === '/tmp/link.gguf') return '/private/tmp/model.gguf'
      return path
    })

    await extension.import('org/model', {
      modelPath: '/tmp/link.gguf',
    })

    expect(mocks.fsState.get('/app-data/llamacpp/models/org/model/model.gguf')).toBe(
      'gguf-binary'
    )
    expect(mocks.fsState.has('/tmp/link.gguf')).toBe(false)
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('canonicalize_path', {
      path: '/tmp/link.gguf',
    })
  })
})
