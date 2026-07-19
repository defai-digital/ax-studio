import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  formatError: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error)
  ),
  checkForBackendUpdate: vi.fn(async () => ({
    updateNeeded: false,
    newVersion: '',
  })),
  fetchRemoteBackends: vi.fn(async () => []),
}))

vi.mock('./provider-sync', () => ({
  decideLocalProviderSync: vi.fn(() => ({ action: 'unregister' })),
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
    onLoad() {
      this.registerEngine()
    }
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
import {
  findSessionByModel,
  getLoadedModels,
  startAxServing,
  unloadLlamaModel,
} from '@ax-studio/tauri-plugin-llamacpp-api'

describe('AxStudioLlamacppExtension', () => {
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
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
    vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
      if (command === 'mlx_hf_snapshot_dir') {
        const { modelId, revision } = args as {
          modelId: string
          revision: string
        }
        return `/hf-cache/models--${modelId.replace(/\//g, '--')}/snapshots/${revision}`
      }
      if (command === 'mlx_has_model_manifest') {
        const modelDir = (args as { modelDir?: string } | undefined)?.modelDir
        return Boolean(modelDir && mocks.fsState.has(`${modelDir}/model-manifest.json`))
      }
      if (command === 'mlx_list_hf_cache_models') {
        return []
      }
      if (command === 'mlx_cleanup_import_artifacts') {
        const paths = (args as { paths?: string[] } | undefined)?.paths ?? []
        for (const path of paths) {
          mocks.fsState.delete(path)
          mocks.dirState.delete(path)
        }
        return undefined
      }
      const path = (args as { path?: string } | undefined)?.path
      return path ?? ''
    })
  })

  afterEach(() => {
    consoleDebugSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    consoleInfoSpy.mockRestore()
    consoleWarnSpy.mockRestore()
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

  it('rejects malformed numeric setting updates', () => {
    const extension = new AxStudioLlamacppExtension('', '')

    extension.onSettingUpdate('timeout', 'Infinity')
    extension.onSettingUpdate('ctx_size', '0x400')
    extension.onSettingUpdate('threads', true)
    extension.onSettingUpdate('ubatch_size', ['1024'])
    extension.onSettingUpdate('rope_scale', '2.5e-1')

    expect((extension as any).timeout).toBe(600)
    expect((extension as any).config.timeout).toBe(600)
    expect((extension as any).config.ctx_size).toBe(0)
    expect((extension as any).config.threads).toBe(-1)
    expect((extension as any).config.ubatch_size).toBe(512)
    expect((extension as any).config.rope_scale).toBe(0.25)
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

  it('reconciles stale ax-serving sessions against health before reporting loaded models', async () => {
    const extension = new AxStudioLlamacppExtension('', '')
    ;(extension as any).axServingPid = 123
    ;(extension as any).axServingPort = 456
    ;(extension as any).axServingSessions.set('Qwen3.6-35B-A3B-4bit', {
      pid: 123,
      port: 456,
      model_id: 'Qwen3.6-35B-A3B-4bit',
      model_path: '/models/qwen',
      is_embedding: false,
      api_key: '',
    })
    ;(extension as any).axServingSessions.set('gemma-4-26b-a4b-it-4bit', {
      pid: 123,
      port: 456,
      model_id: 'gemma-4-26b-a4b-it-4bit',
      model_path: '/models/gemma',
      is_embedding: false,
      api_key: '',
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ loaded_models: ['gemma-4-26b-a4b-it-4bit'] }),
    } as Response)

    await expect(extension.getLoadedModels()).resolves.toEqual([
      'gemma-4-26b-a4b-it-4bit',
    ])

    expect((extension as any).axServingSessions.has('Qwen3.6-35B-A3B-4bit')).toBe(false)
    expect((extension as any).axServingSessions.has('gemma-4-26b-a4b-it-4bit')).toBe(true)
    fetchSpy.mockRestore()
  })

  it('does not expose the ax-serving service marker as a loaded chat model', async () => {
    const extension = new AxStudioLlamacppExtension('', '')
    vi.mocked(getLoadedModels).mockResolvedValueOnce([
      '__ax_serving__',
      'llama-model',
    ])

    await expect(extension.getLoadedModels()).resolves.toEqual(['llama-model'])
  })

  it('reconciles provider state when unloading a missing llamacpp session', async () => {
    const extension = new AxStudioLlamacppExtension('', '')
    vi.mocked(findSessionByModel).mockResolvedValueOnce(null)
    vi.mocked(getLoadedModels).mockResolvedValueOnce([])

    await expect(extension.unload('crashed-model')).resolves.toEqual({
      success: true,
    })

    expect(invoke).toHaveBeenCalledWith('unregister_provider_config', {
      provider: 'llamacpp',
    })
    expect(mocks.emit).toHaveBeenCalledWith('OnModelStopped', {
      modelId: 'crashed-model',
      provider: 'llamacpp',
    })
  })

  it('emits model stopped even when crashed process cleanup fails', async () => {
    const extension = new AxStudioLlamacppExtension('', '')
    vi.mocked(findSessionByModel).mockResolvedValueOnce({
      pid: 4321,
      port: 1234,
      model_id: 'crashed-model',
      model_path: '/app-data/llamacpp/models/crashed/model.gguf',
      is_embedding: false,
      api_key: 'key',
    })
    vi.mocked(unloadLlamaModel).mockRejectedValueOnce(new Error('process gone'))
    vi.mocked(getLoadedModels).mockResolvedValueOnce([])

    await expect(extension.unload('crashed-model')).resolves.toEqual({
      success: false,
      error: 'process gone',
    })

    expect(invoke).toHaveBeenCalledWith('unregister_provider_config', {
      provider: 'llamacpp',
    })
    expect(mocks.emit).toHaveBeenCalledWith('OnModelStop', {
      modelId: 'crashed-model',
      provider: 'llamacpp',
    })
    expect(mocks.emit).toHaveBeenCalledWith('OnModelStopped', {
      modelId: 'crashed-model',
      provider: 'llamacpp',
    })
  })

  it('waits for engine switch cleanup before loading through ax-serving', async () => {
    const extension = new AxStudioLlamacppExtension('', '')
    ;(extension as any).config = {
      engine_type: 'ax-serving',
      n_gpu_layers: -1,
      ctx_size: 0,
    }
    mocks.dirState.add('/app-data/llamacpp/models/ax-model')
    mocks.fsState.set(
      '/app-data/llamacpp/models/ax-model/model.yml',
      [
        'model_path: llamacpp/models/ax-model/model.gguf',
        'name: ax-model',
        'size_bytes: 123',
        'embedding: false',
      ].join('\n')
    )
    mocks.fsState.set('/app-data/llamacpp/models/ax-model/model.gguf', 'gguf')
    mocks.fsState.set('/app-data/llamacpp/models/ax-model/model-manifest.json', '{}')

    vi.mocked(getLoadedModels).mockResolvedValue([])
    vi.mocked(startAxServing).mockResolvedValue({
      pid: 321,
      port: 6543,
      model_id: '__ax_serving__',
      model_path: '/backend/ax-serving',
      is_embedding: false,
      api_key: '',
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => '',
    } as Response)

    let releaseCleanup!: () => void
    ;(extension as any).engineSwitchQueue = new Promise<void>((resolve) => {
      releaseCleanup = resolve
    })

    const loadPromise = extension.load('ax-model', undefined, false, true)
    await Promise.resolve()

    expect(startAxServing).not.toHaveBeenCalled()

    releaseCleanup()
    await expect(loadPromise).resolves.toMatchObject({
      model_id: 'ax-model',
      port: 6543,
    })
    expect(startAxServing).toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:6543/v1/models',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"model_id":"ax-model"'),
      })
    )

    fetchSpy.mockRestore()
  })

  it('loads cached Hugging Face MLX repos through ax-serving without a local model.yml', async () => {
    const extension = new AxStudioLlamacppExtension('', '')
    ;(extension as any).config = {
      engine_type: 'llamacpp',
      n_gpu_layers: -1,
      ctx_size: 0,
    }

    const repoDir =
      '/home/devop/.cache/huggingface/hub/models--mlx-community--Qwen3.6-27B-4bit'
    const snapshotsDir = `${repoDir}/snapshots`
    const snapshotDir = `${snapshotsDir}/abc123`
    mocks.fsState.set(`${snapshotDir}/model-manifest.json`, '{}')
    vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
      if (command === 'mlx_resolve_model_dir') return snapshotDir
      if (command === 'mlx_has_model_manifest') {
        const modelDir = (args as { modelDir?: string } | undefined)?.modelDir
        return Boolean(modelDir && mocks.fsState.has(`${modelDir}/model-manifest.json`))
      }
      if (command === 'mlx_list_hf_cache_models') return []
      const path = (args as { path?: string } | undefined)?.path
      return path ?? ''
    })

    vi.mocked(getLoadedModels).mockResolvedValue([])
    vi.mocked(startAxServing).mockResolvedValue({
      pid: 321,
      port: 6543,
      model_id: '__ax_serving__',
      model_path: '/backend/ax-serving',
      is_embedding: false,
      api_key: '',
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => '',
    } as Response)

    await expect(
      extension.load('mlx-community/Qwen3.6-27B-4bit', undefined, false, true)
    ).resolves.toMatchObject({
      model_id: 'mlx-community/Qwen3.6-27B-4bit',
      model_path: snapshotDir,
      port: 6543,
    })

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:6543/v1/models',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining(`"path":"${snapshotDir}"`),
      })
    )
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:6543/v1/models',
      expect.objectContaining({
        body: expect.stringContaining(
          '"model_id":"mlx-community_Qwen3.6-27B-4bit"'
        ),
      })
    )
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:6543/v1/models',
      expect.objectContaining({
        body: expect.stringContaining('"backend":"native"'),
      })
    )

    fetchSpy.mockRestore()
  })

  it('does not forward malformed numeric load settings to ax-serving', async () => {
    const extension = new AxStudioLlamacppExtension('', '')
    ;(extension as any).config = {
      engine_type: 'ax-serving',
      n_gpu_layers: '0x10',
      ctx_size: '0x100000',
    }
    mocks.dirState.add('/app-data/llamacpp/models/ax-model')
    mocks.fsState.set(
      '/app-data/llamacpp/models/ax-model/model.yml',
      [
        'model_path: llamacpp/models/ax-model/model.gguf',
        'name: ax-model',
        'size_bytes: 123',
        'embedding: false',
      ].join('\n')
    )
    mocks.fsState.set('/app-data/llamacpp/models/ax-model/model.gguf', 'gguf')
    mocks.fsState.set('/app-data/llamacpp/models/ax-model/model-manifest.json', '{}')

    vi.mocked(getLoadedModels).mockResolvedValue([])
    vi.mocked(startAxServing).mockResolvedValue({
      pid: 321,
      port: 6543,
      model_id: '__ax_serving__',
      model_path: '/backend/ax-serving',
      is_embedding: false,
      api_key: '',
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({}),
      text: async () => '',
    } as Response)

    await expect(
      extension.load('ax-model', undefined, false, true)
    ).resolves.toMatchObject({
      model_id: 'ax-model',
      port: 6543,
    })

    const loadCall = fetchSpy.mock.calls.find(
      ([url]) => String(url) === 'http://127.0.0.1:6543/v1/models'
    )
    expect(loadCall).toBeDefined()
    const loadBody = JSON.parse(
      String((loadCall?.[1] as RequestInit | undefined)?.body)
    )
    expect(loadBody).not.toHaveProperty('n_gpu_layers')
    expect(loadBody).not.toHaveProperty('context_length')

    fetchSpy.mockRestore()
  })

  it('uses the default embedding batch size for malformed ubatch_size config', async () => {
    const extension = new AxStudioLlamacppExtension('', '')
    ;(extension as any).config = {
      ubatch_size: '0x10',
    }
    ;(extension as any).axServingSessions.set('embedding-model', {
      pid: 321,
      port: 6543,
      model_id: 'embedding-model',
      model_path: '/models/embedding',
      is_embedding: true,
      api_key: 'key',
    })
    vi.spyOn(extension as any, '_healthCheck').mockResolvedValue(undefined)
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { embedding: [0.1], index: 0, object: 'embedding' },
          { embedding: [0.2], index: 1, object: 'embedding' },
        ],
        usage: { prompt_tokens: 2, total_tokens: 2 },
      }),
      text: async () => '',
    } as Response)

    await expect(
      extension.embed({
        modelId: 'embedding-model',
        inputs: ['a'.repeat(30), 'b'.repeat(30)],
      })
    ).resolves.toMatchObject({
      model: 'embedding-model',
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const body = JSON.parse(
      String((fetchSpy.mock.calls[0][1] as RequestInit | undefined)?.body)
    )
    expect(body.input).toEqual(['a'.repeat(30), 'b'.repeat(30)])

    fetchSpy.mockRestore()
  })

  it('imports Hugging Face MLX repos into the Hugging Face snapshot cache', async () => {
    const extension = new AxStudioLlamacppExtension('', '')
    const snapshotDir =
      '/hf-cache/models--mlx-community--gemma-4-12B-it-4bit/snapshots/abc123'
    const downloadFiles = vi.fn(
      async (
        items: Array<{ save_path: string }>,
        _taskId: string,
        _headers?: Record<string, string>,
        onProgress?: (transferred: number, total: number) => void
      ) => {
        onProgress?.(512, 1024)
        for (const item of items) {
          mocks.fsState.set(item.save_path, 'downloaded')
          mocks.fsState.set(`/app-data/${item.save_path}`, 'downloaded')
        }
      }
    )
    ;((globalThis as any).core.extensionManager.getByName as any).mockReturnValue({
      downloadFiles,
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        sha: 'abc123',
        siblings: [
          {
            rfilename: 'model-manifest.json',
            size: 64,
          },
          {
            rfilename: 'model-00001-of-00001.safetensors',
            lfs: {
              sha256: 'abc',
              size: 1024,
            },
          },
          {
            rfilename: 'tokenizer.json',
            size: 128,
          },
        ],
      }),
      text: async () => '',
    } as Response)

    await extension.import('mlx-community/gemma-4-12B-it-4bit', {
      modelPath: 'hf://mlx-community/gemma-4-12B-it-4bit',
      downloadHeaders: { Authorization: 'Bearer hf_token' },
    } as any)

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://huggingface.co/api/models/mlx-community/gemma-4-12B-it-4bit?blobs=true&files_metadata=true',
      {
        headers: { Authorization: 'Bearer hf_token' },
        signal: expect.any(AbortSignal),
      }
    )
    expect(downloadFiles).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://huggingface.co/mlx-community/gemma-4-12B-it-4bit/resolve/abc123/model-manifest.json',
          save_path: `${snapshotDir}/model-manifest.json`,
        }),
        expect.objectContaining({
          url: 'https://huggingface.co/mlx-community/gemma-4-12B-it-4bit/resolve/abc123/model-00001-of-00001.safetensors',
          save_path: `${snapshotDir}/model-00001-of-00001.safetensors`,
          sha256: 'abc',
          size: 1024,
        }),
      ]),
      'mlx-import-mlx-community/gemma-4-12B-it-4bit',
      { Authorization: 'Bearer hf_token' },
      expect.any(Function)
    )
    expect(
      mocks.fsState.get(
        '/app-data/llamacpp/models/mlx-community/gemma-4-12B-it-4bit/model.yml'
      )
    ).toContain(
      `model_path: "${snapshotDir}"`
    )
    expect(mocks.emit).toHaveBeenCalledWith('onModelImported', {
      modelId: 'mlx-community/gemma-4-12B-it-4bit',
    })
    expect(consoleDebugSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  it('generates AX manifest after importing Hugging Face MLX repos without one', async () => {
    const extension = new AxStudioLlamacppExtension('', '')
    const snapshotDir =
      '/hf-cache/models--mlx-community--Qwen3.5-9B-MLX-4bit/snapshots/main'
    const downloadFiles = vi.fn(
      async (
        items: Array<{ save_path: string }>,
        _taskId: string,
        _headers?: Record<string, string>,
        onProgress?: (transferred: number, total: number) => void
      ) => {
        onProgress?.(2048, 2048)
        for (const item of items) {
          mocks.fsState.set(item.save_path, 'downloaded')
          mocks.fsState.set(`/app-data/${item.save_path}`, 'downloaded')
        }
      }
    )
    ;((globalThis as any).core.extensionManager.getByName as any).mockReturnValue({
      downloadFiles,
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (url: RequestInfo | URL) =>
        ({
          ok: true,
          json: async () =>
            String(url).endsWith('/config.json')
              ? { model_type: 'qwen3_5' }
              : {
                  siblings: [
                    {
                      rfilename: 'model-00001-of-00001.safetensors',
                      lfs: {
                        sha256: 'abc',
                        size: 2048,
                      },
                    },
                    {
                      rfilename: 'config.json',
                      size: 128,
                    },
                  ],
                },
          text: async () => '',
        }) as Response
    )

    await extension.import('mlx-community/Qwen3.5-9B-MLX-4bit', {
      modelPath: 'hf://mlx-community/Qwen3.5-9B-MLX-4bit',
    } as any)

    expect(mocks.dirState.has('/app-data/llamacpp')).toBe(true)
    expect(mocks.dirState.has('/app-data/llamacpp/models')).toBe(true)
    expect(mocks.dirState.has('/app-data/llamacpp/models/mlx-community')).toBe(
      true
    )
    expect(
      mocks.dirState.has(
        '/app-data/llamacpp/models/mlx-community/Qwen3.5-9B-MLX-4bit'
      )
    ).toBe(true)
    expect(downloadFiles).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          url: 'https://huggingface.co/mlx-community/Qwen3.5-9B-MLX-4bit/resolve/main/model-00001-of-00001.safetensors',
          save_path: `${snapshotDir}/model-00001-of-00001.safetensors`,
        }),
      ]),
      'mlx-import-mlx-community/Qwen3.5-9B-MLX-4bit',
      undefined,
      expect.any(Function)
    )
    expect(invoke).toHaveBeenCalledWith('mlx_generate_model_manifest', {
      modelDir: snapshotDir,
    })
    expect(
      mocks.fsState.get(
        '/app-data/llamacpp/models/mlx-community/Qwen3.5-9B-MLX-4bit/model.yml'
      )
    ).toContain(
      `model_path: "${snapshotDir}"`
    )

    fetchSpy.mockRestore()
  })

  it('generates AX manifest for Gemma MLX repos without bundled manifests', async () => {
    const extension = new AxStudioLlamacppExtension('', '')
    const snapshotDir =
      '/hf-cache/models--mlx-community--gemma-4-12B-it-4bit/snapshots/main'
    const downloadFiles = vi.fn(
      async (
        items: Array<{ save_path: string }>,
        _taskId: string,
        _headers?: Record<string, string>,
        onProgress?: (transferred: number, total: number) => void
      ) => {
        onProgress?.(6_741_039_511, 6_741_039_511)
        for (const item of items) {
          mocks.fsState.set(item.save_path, 'downloaded')
          mocks.fsState.set(`/app-data/${item.save_path}`, 'downloaded')
        }
      }
    )
    ;((globalThis as any).core.extensionManager.getByName as any).mockReturnValue({
      downloadFiles,
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (url: RequestInfo | URL) =>
        ({
          ok: true,
          json: async () =>
            String(url).endsWith('/config.json')
              ? {
                  model_type: 'gemma4_unified',
                  text_config: { model_type: 'gemma4_unified_text' },
                }
              : {
                  siblings: [
                    {
                      rfilename: 'config.json',
                      size: 5415,
                    },
                    {
                      rfilename: 'model-00001-of-00002.safetensors',
                      lfs: {
                        sha256: 'abc',
                        size: 5_351_756_584,
                      },
                    },
                    {
                      rfilename: 'model-00002-of-00002.safetensors',
                      lfs: {
                        sha256: 'def',
                        size: 1_389_282_927,
                      },
                    },
                    {
                      rfilename: 'model.safetensors.index.json',
                      size: 135_329,
                    },
                    {
                      rfilename: 'tokenizer.json',
                      lfs: {
                        sha256: 'tokenizer-sha',
                        size: 32_169_626,
                      },
                    },
                  ],
                },
          text: async () => '',
        }) as Response
    )

    await extension.import('mlx-community/gemma-4-12B-it-4bit', {
      modelPath: 'hf://mlx-community/gemma-4-12B-it-4bit',
    } as any)

    expect(invoke).toHaveBeenCalledWith('mlx_generate_model_manifest', {
      modelDir: snapshotDir,
    })
    expect(
      mocks.fsState.get(
        '/app-data/llamacpp/models/mlx-community/gemma-4-12B-it-4bit/model.yml'
      )
    ).toContain(
      `model_path: "${snapshotDir}"`
    )
    expect(mocks.emit).toHaveBeenCalledWith('onModelImported', {
      modelId: 'mlx-community/gemma-4-12B-it-4bit',
    })

    fetchSpy.mockRestore()
  })

  it('generates AX manifest for DiffusionGemma MLX repos without bundled manifests', async () => {
    const extension = new AxStudioLlamacppExtension('', '')
    const snapshotDir =
      '/hf-cache/models--mlx-community--diffusiongemma-26B-A4B-it-4bit/snapshots/main'
    const downloadFiles = vi.fn(
      async (
        items: Array<{ save_path: string }>,
        _taskId: string,
        _headers?: Record<string, string>,
        onProgress?: (transferred: number, total: number) => void
      ) => {
        onProgress?.(16_543_055_405, 16_543_055_405)
        for (const item of items) {
          mocks.fsState.set(item.save_path, 'downloaded')
          mocks.fsState.set(`/app-data/${item.save_path}`, 'downloaded')
        }
      }
    )
    ;((globalThis as any).core.extensionManager.getByName as any).mockReturnValue({
      downloadFiles,
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (url: RequestInfo | URL) =>
        ({
          ok: true,
          json: async () =>
            String(url).endsWith('/config.json')
              ? {
                  model_type: 'diffusion_gemma',
                  text_config: { model_type: 'diffusion_gemma_text' },
                }
              : {
                  siblings: [
                    {
                      rfilename: 'config.json',
                      size: 58_854,
                    },
                    {
                      rfilename: 'model-00001-of-00004.safetensors',
                      lfs: {
                        sha256: 'abc',
                        size: 5_215_121_220,
                      },
                    },
                    {
                      rfilename: 'model-00002-of-00004.safetensors',
                      lfs: {
                        sha256: 'def',
                        size: 5_358_706_305,
                      },
                    },
                  ],
                },
          text: async () => '',
        }) as Response
    )

    await extension.import('mlx-community/diffusiongemma-26B-A4B-it-4bit', {
      modelPath: 'hf://mlx-community/diffusiongemma-26B-A4B-it-4bit',
    } as any)

    expect(invoke).toHaveBeenCalledWith('mlx_generate_model_manifest', {
      modelDir: snapshotDir,
    })
    expect(
      mocks.fsState.get(
        '/app-data/llamacpp/models/mlx-community/diffusiongemma-26B-A4B-it-4bit/model.yml'
      )
    ).toContain(
      `model_path: "${snapshotDir}"`
    )
    expect(mocks.emit).toHaveBeenCalledWith('onModelImported', {
      modelId: 'mlx-community/diffusiongemma-26B-A4B-it-4bit',
    })

    fetchSpy.mockRestore()
  })

  it('reports Gemma MLX manifest failures after download completion', async () => {
    const extension = new AxStudioLlamacppExtension('', '')
    const downloadFiles = vi.fn(
      async (
        items: Array<{ save_path: string }>,
        _taskId: string,
        _headers?: Record<string, string>,
        onProgress?: (transferred: number, total: number) => void
      ) => {
        onProgress?.(1024, 1024)
        for (const item of items) {
          mocks.fsState.set(item.save_path, 'downloaded')
          mocks.fsState.set(`/app-data/${item.save_path}`, 'downloaded')
        }
      }
    )
    ;((globalThis as any).core.extensionManager.getByName as any).mockReturnValue({
      downloadFiles,
    })
    vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown) => {
      if (command === 'mlx_hf_snapshot_dir') {
        const { modelId, revision } = args as {
          modelId: string
          revision: string
        }
        return `/hf-cache/models--${modelId.replace(/\//g, '--')}/snapshots/${revision}`
      }
      if (command === 'mlx_cleanup_import_artifacts') {
        const paths = (args as { paths?: string[] } | undefined)?.paths ?? []
        for (const path of paths) mocks.fsState.delete(path)
        return undefined
      }
      if (command === 'mlx_generate_model_manifest') {
        throw new Error('failed to generate AX manifest: unsupported model type')
      }
      const path = (args as { path?: string } | undefined)?.path
      return path ?? ''
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (url: RequestInfo | URL) =>
        ({
          ok: true,
          json: async () =>
            String(url).endsWith('/config.json')
              ? { model_type: 'gemma4' }
              : {
                  siblings: [
                    {
                      rfilename: 'model.safetensors',
                      lfs: {
                        sha256: 'abc',
                        size: 1024,
                      },
                    },
                    {
                      rfilename: 'config.json',
                      size: 128,
                    },
                  ],
                },
          text: async () => '',
        }) as Response
    )

    await expect(
      extension.import('mlx-community/gemma-4-e2b-it-4bit', {
        modelPath: 'hf://mlx-community/gemma-4-e2b-it-4bit',
      } as any)
    ).rejects.toThrow(
      'Downloaded mlx-community/gemma-4-e2b-it-4bit, but Ax Engine could not prepare it for MLX inference'
    )
    expect(mocks.emit).toHaveBeenCalledWith(
      'onFileDownloadError',
      expect.objectContaining({
        modelId: 'mlx-community/gemma-4-e2b-it-4bit',
        error: expect.stringContaining('could not prepare it for MLX inference'),
      })
    )
    expect(
      mocks.fsState.has(
        '/app-data/llamacpp/models/mlx-community/gemma-4-e2b-it-4bit/model.yml'
      )
    ).toBe(false)

    fetchSpy.mockRestore()
  })

  it('downloads Gemma 3 MLX repos and delegates manifest support to Ax Engine', async () => {
    const extension = new AxStudioLlamacppExtension('', '')
    const downloadFiles = vi.fn()
    ;((globalThis as any).core.extensionManager.getByName as any).mockReturnValue({
      downloadFiles,
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (url: RequestInfo | URL) =>
        ({
          ok: true,
          json: async () =>
            String(url).endsWith('/config.json')
              ? {
                  model_type: 'gemma3',
                  text_config: { model_type: 'gemma3_text' },
                }
              : {
                  siblings: [
                    {
                      rfilename: 'model.safetensors',
                      lfs: {
                        sha256: 'abc',
                        size: 1024,
                      },
                    },
                    {
                      rfilename: 'config.json',
                      size: 128,
                    },
                  ],
                },
          text: async () => '',
        }) as Response
    )

    await expect(
      extension.import('mlx-community/gemma-3-4b-it-4bit', {
        modelPath: 'hf://mlx-community/gemma-3-4b-it-4bit',
      } as any)
    ).resolves.toBeUndefined()
    expect(downloadFiles).toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith('mlx_generate_model_manifest', {
      modelDir:
        '/hf-cache/models--mlx-community--gemma-3-4b-it-4bit/snapshots/main',
    })

    fetchSpy.mockRestore()
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

  it('normalizes quoted model config scalars defensively', async () => {
    const extension = new AxStudioLlamacppExtension('', '')
    mocks.fsState.set(
      '/app-data/llamacpp/models/org/model/model.yml',
      [
        'model_path: llamacpp/models/org/model/model.gguf',
        'name: org/model',
        'size_bytes: "not-a-number"',
        'embedding: "false"',
      ].join('\n')
    )

    const config = await (extension as any)._readModelConfig('org/model')
    expect(config).toMatchObject({
      size_bytes: 0,
      embedding: false,
    })
  })

  it('lists local models when readdir returns relative names', async () => {
    const extension = new AxStudioLlamacppExtension('', '')
    mocks.dirState.add('/app-data/llamacpp/models/Qwen3-4B-Instruct-MLX')
    mocks.fsState.set(
      '/app-data/llamacpp/models/Qwen3-4B-Instruct-MLX/model.yml',
      [
        'model_path: llamacpp/models/Qwen3-4B-Instruct-MLX',
        'name: Qwen3-4B-Instruct-MLX',
        'size_bytes: 123',
        'embedding: false',
      ].join('\n')
    )
    vi.mocked((await import('@ax-studio/core')).fs.readdirSync).mockImplementation(
      async (path: string) => {
        if (path === '/app-data/llamacpp/models') return ['Qwen3-4B-Instruct-MLX']
        return []
      }
    )

    await expect(extension.list()).resolves.toMatchObject([
      {
        id: 'Qwen3-4B-Instruct-MLX',
        name: 'Qwen3-4B-Instruct-MLX',
        providerId: 'llamacpp',
      },
    ])
  })

  it('lists local models when readdir returns absolute paths', async () => {
    const extension = new AxStudioLlamacppExtension('', '')
    mocks.dirState.add('/app-data/llamacpp/models/gemma-4-26b-a4b-it-4bit')
    mocks.fsState.set(
      '/app-data/llamacpp/models/gemma-4-26b-a4b-it-4bit/model.yml',
      [
        'model_path: llamacpp/models/gemma-4-26b-a4b-it-4bit',
        'name: gemma-4-26b-a4b-it-4bit',
        'size_bytes: 456',
        'embedding: false',
      ].join('\n')
    )
    vi.mocked((await import('@ax-studio/core')).fs.readdirSync).mockImplementation(
      async (path: string) => {
        if (path === '/app-data/llamacpp/models') {
          return ['/app-data/llamacpp/models/gemma-4-26b-a4b-it-4bit']
        }
        return []
      }
    )

    await expect(extension.list()).resolves.toMatchObject([
      {
        id: 'gemma-4-26b-a4b-it-4bit',
        name: 'gemma-4-26b-a4b-it-4bit',
        providerId: 'llamacpp',
      },
    ])
  })

  it('lists downloaded nested Hugging Face MLX model directories', async () => {
    const extension = new AxStudioLlamacppExtension('', '')
    const modelDir = '/app-data/llamacpp/models/mlx-community/Qwen3.5-4B-4bit'
    mocks.fsState.set(
      `${modelDir}/model.yml`,
      [
        'model_path: llamacpp/models/mlx-community/Qwen3.5-4B-4bit',
        'name: mlx-community/Qwen3.5-4B-4bit',
        'size_bytes: 3061130647',
        'embedding: false',
      ].join('\n')
    )
    mocks.fsState.set(`${modelDir}/model-manifest.json`, '{}')

    vi.mocked((await import('@ax-studio/core')).fs.readdirSync).mockImplementation(
      async (path: string) => {
        if (path === '/app-data/llamacpp/models') return ['mlx-community']
        if (path === '/app-data/llamacpp/models/mlx-community') {
          return ['Qwen3.5-4B-4bit']
        }
        return []
      }
    )

    await expect(extension.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
	          id: 'mlx-community/Qwen3.5-4B-4bit',
	          name: 'mlx-community/Qwen3.5-4B-4bit',
	          providerId: 'ax-engine',
	          path: 'llamacpp/models/mlx-community/Qwen3.5-4B-4bit',
	        }),
      ])
    )
  })

  it('lists models discovered in the Hugging Face hub cache without model.yml', async () => {
    const extension = new AxStudioLlamacppExtension('', '')
    const snapshotDir =
      '/hf-cache/models--mlx-community--Qwen3.5-9B-MLX-4bit/snapshots/abc123'
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'mlx_list_hf_cache_models') {
        return [
          {
            model_id: 'mlx-community/Qwen3.5-9B-MLX-4bit',
            model_dir: snapshotDir,
            has_manifest: true,
            size_bytes: 4_200_000_000,
          },
          {
            model_id: 'mlx-community/weights-only',
            model_dir: '/hf-cache/weights-only',
            has_manifest: false,
            size_bytes: 100,
          },
        ]
      }
      return undefined
    })

    const listed = await extension.list()
    expect(listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'mlx-community/Qwen3.5-9B-MLX-4bit',
          providerId: 'ax-engine',
          path: snapshotDir,
          sizeBytes: 4_200_000_000,
        }),
      ])
    )
    expect(listed.find((m) => m.id === 'mlx-community/weights-only')).toBeUndefined()
    expect(
      mocks.fsState.get(
        '/app-data/llamacpp/models/mlx-community/Qwen3.5-9B-MLX-4bit/model.yml'
      )
    ).toContain(snapshotDir)
  })

  it('lists AX manifest models under mlx and plain models under llamacpp', async () => {
    const extension = new AxStudioLlamacppExtension('', '')
    ;(extension as any).config = { engine_type: 'ax-serving' }
    mocks.dirState.add('/app-data/llamacpp/models/Qwen2.5-32B-Instruct-4bit')
    mocks.dirState.add('/app-data/llamacpp/models/Qwen3.5-35B-A3B-4bit')
    mocks.fsState.set(
      '/app-data/llamacpp/models/Qwen2.5-32B-Instruct-4bit/model.yml',
      [
        'model_path: llamacpp/models/Qwen2.5-32B-Instruct-4bit',
        'name: Qwen2.5-32B-Instruct-4bit',
        'size_bytes: 123',
        'embedding: false',
      ].join('\n')
    )
    mocks.fsState.set(
      '/app-data/llamacpp/models/Qwen3.5-35B-A3B-4bit/model.yml',
      [
        'model_path: llamacpp/models/Qwen3.5-35B-A3B-4bit',
        'name: Qwen3.5-35B-A3B-4bit',
        'size_bytes: 456',
        'embedding: false',
      ].join('\n')
    )
    mocks.fsState.set(
      '/app-data/llamacpp/models/Qwen3.5-35B-A3B-4bit/model-manifest.json',
      '{}'
    )
    vi.mocked((await import('@ax-studio/core')).fs.readdirSync).mockImplementation(
      async (path: string) => {
        if (path === '/app-data/llamacpp/models') {
          return ['Qwen2.5-32B-Instruct-4bit', 'Qwen3.5-35B-A3B-4bit']
        }
        return []
      }
    )

    await expect(extension.list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'Qwen2.5-32B-Instruct-4bit',
          name: 'Qwen2.5-32B-Instruct-4bit',
          providerId: 'llamacpp',
        }),
	        expect.objectContaining({
	          id: 'Qwen3.5-35B-A3B-4bit',
	          name: 'Qwen3.5-35B-A3B-4bit',
	          providerId: 'ax-engine',
	        }),
      ])
    )
	    await expect(extension.get('Qwen2.5-32B-Instruct-4bit')).resolves.toMatchObject({
	      id: 'Qwen2.5-32B-Instruct-4bit',
	      providerId: 'llamacpp',
	    })
	    await expect(extension.get('Qwen3.5-35B-A3B-4bit')).resolves.toMatchObject({
	      id: 'Qwen3.5-35B-A3B-4bit',
	      providerId: 'ax-engine',
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

  it('validates local model hashes through the native streaming command', async () => {
    const validateSha256 = vi.fn().mockResolvedValue(true)
    ;(globalThis as any).core.api.validateSha256 = validateSha256
    const extension = new AxStudioLlamacppExtension('', '')

    const valid = await (
      extension as unknown as {
        _validateSha256(path: string, expected: string): Promise<boolean>
      }
    )._validateSha256('/models/model.gguf', 'a'.repeat(64))

    expect(valid).toBe(true)
    expect(validateSha256).toHaveBeenCalledWith({
      path: '/models/model.gguf',
      expected: 'a'.repeat(64),
    })
  })

  it('fails closed when local SHA-256 validation is unavailable', async () => {
    const extension = new AxStudioLlamacppExtension('', '')

    await expect(
      (
        extension as unknown as {
          _validateSha256(path: string, expected: string): Promise<boolean>
        }
      )._validateSha256('/models/model.gguf', 'a'.repeat(64))
    ).resolves.toBe(false)
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
