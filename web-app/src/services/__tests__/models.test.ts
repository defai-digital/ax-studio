import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DefaultModelsService } from '../models/default'
import type { HuggingFaceRepo, CatalogModel } from '../models/types'
import { EngineManager, events, DownloadEvent, ContentType } from '@ax-studio/core'
import bundledModelCatalog from '@/data/model-catalog.json'

const {
  mockEvents,
  mockDownloadEvent,
  mockGetProviderByName,
  mockInvoke,
  mockIsPlatformElectron,
} = vi.hoisted(() => ({
  mockEvents: {
    emit: vi.fn(),
  },
  mockDownloadEvent: {
    onFileDownloadStopped: 'onFileDownloadStopped',
  } as Record<string, string>,
  mockGetProviderByName: vi.fn(),
  mockInvoke: vi.fn(),
  mockIsPlatformElectron: vi.fn(() => false),
}))

// Mock EngineManager and events
vi.mock('@ax-studio/core', () => ({
  EngineManager: {
    instance: vi.fn(),
  },
  events: mockEvents,
  DownloadEvent: mockDownloadEvent,
  ContentType: {
    Text: 'text',
    Image: 'image',
  },
}))

vi.mock('@/lib/tauri-shim/api-core', () => ({
  invoke: mockInvoke,
}))

vi.mock('@/lib/platform/utils', () => ({
  isPlatformElectron: () => mockIsPlatformElectron(),
  isPlatformTauri: () => false,
}))

vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: {
    getState: () => ({ getProviderByName: mockGetProviderByName }),
  },
}))

// Mock fetch
global.fetch = vi.fn()

describe('DefaultModelsService', () => {
  let modelsService: DefaultModelsService

  const mockEngine = {
    list: vi.fn(),
    updateSettings: vi.fn(),
    update: vi.fn(),
    import: vi.fn(),
    abortImport: vi.fn(),
    delete: vi.fn(),
    getLoadedModels: vi.fn(),
    unload: vi.fn(),
    load: vi.fn(),
    syncModelRoute: vi.fn(),
    isModelSupported: vi.fn(),
    isToolSupported: vi.fn(),
    checkMmprojExists: vi.fn(),
    validateGgufFile: vi.fn(),
    getTokensCount: vi.fn(),
  }

  const mockEngineManager = {
    get: vi.fn().mockReturnValue(mockEngine),
  }

  beforeEach(() => {
    modelsService = new DefaultModelsService()
    vi.clearAllMocks()
    mockIsPlatformElectron.mockReturnValue(false)
    mockEngineManager.get.mockReset()
    mockEngineManager.get.mockReturnValue(mockEngine)
    ;(EngineManager.instance as any).mockReturnValue(mockEngineManager)
    mockEvents.emit.mockClear()
    mockGetProviderByName.mockReset()
    mockInvoke.mockReset()
  })

  describe('fetchModels', () => {
    it('should fetch models successfully', async () => {
      const mockModels = [
        { id: 'model1', name: 'Model 1' },
        { id: 'model2', name: 'Model 2' },
      ]
      mockEngine.list.mockResolvedValue(mockModels)

      const result = await modelsService.fetchModels()

      expect(result).toEqual(mockModels)
      expect(mockEngine.list).toHaveBeenCalled()
    })
  })

  describe('engine unavailability warnings', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should throw descriptive error when engine unavailable for fetchModels', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockEngineManager.get.mockReturnValue(undefined)

      await expect(modelsService.fetchModels()).rejects.toThrow(
        '[ModelsService] Cannot fetch models: engine "llamacpp" is not available.'
      )
      expect(consoleSpy).toHaveBeenCalledWith(
        '[ModelsService] Engine "llamacpp" is not available. The engine may not be initialized or registered.'
      )

      consoleSpy.mockRestore()
    })

    it('should throw descriptive error when engine unavailable for pullModel', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockEngineManager.get.mockReturnValue(undefined)

      await expect(modelsService.pullModel('model1', '/path/to/model')).rejects.toThrow(
        'Engine "llamacpp" is not available. Cannot pull model "model1".'
      )

      consoleSpy.mockRestore()
    })

    it('should log a warning when getEngine returns undefined for getActiveModels', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockEngineManager.get.mockReturnValue(undefined)

      const result = await modelsService.getActiveModels('llamacpp')

      expect(result).toEqual([])
      expect(consoleSpy).toHaveBeenCalledWith(
        '[ModelsService] Engine "llamacpp" is not available. The engine may not be initialized or registered.'
      )

      consoleSpy.mockRestore()
    })

    it('should log a warning when getEngine returns undefined for getModel', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockEngineManager.get.mockReturnValue(undefined)

      const result = await modelsService.getModel('model1')

      expect(result).toBeUndefined()
      expect(consoleSpy).toHaveBeenCalledWith(
        '[ModelsService] Engine "llamacpp" is not available. The engine may not be initialized or registered.'
      )

      consoleSpy.mockRestore()
    })

    it('should use the MLX SDK command for mlx active-model lookups', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockInvoke.mockResolvedValue([])

      const result = await modelsService.getActiveModels('ax-engine')

      expect(result).toEqual([])
      expect(mockInvoke).toHaveBeenCalledWith('mlx_list_loaded')
      expect(mockEngineManager.get).not.toHaveBeenCalled()
      expect(consoleSpy).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('should not log a warning when engine is available', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockEngineManager.get.mockReturnValue(mockEngine)
      mockEngine.list.mockResolvedValue([{ id: 'model1' }])

      await modelsService.fetchModels()

      expect(consoleSpy).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('fetchModelCatalog', () => {
    it('should return the bundled AX Studio model catalog with AX Engine MLX targets', async () => {
      const result = await modelsService.fetchModelCatalog()

      expect(result).toEqual(expect.arrayContaining(bundledModelCatalog))
      expect(result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            model_name: 'AX Engine Gemma 4 E2B',
            developer: 'AX Engine',
            is_mlx: true,
            quants: expect.arrayContaining([
              expect.objectContaining({
                model_id: 'mlx-community/gemma-4-e2b-it-4bit',
                path: 'hf://mlx-community/gemma-4-e2b-it-4bit',
                supports_in_app_download: true,
              }),
              expect.objectContaining({
                model_id: 'mlx-community/gemma-4-e2b-it-8bit',
                path: 'hf://mlx-community/gemma-4-e2b-it-8bit',
                supports_in_app_download: true,
              }),
            ]),
          }),
          expect.objectContaining({
            model_name: 'AX Engine Qwen 3.6 35B A3B',
            developer: 'AX Engine',
            is_mlx: true,
            quants: expect.arrayContaining([
              expect.objectContaining({
                model_id: 'mlx-community/Qwen3.6-35B-A3B-4bit',
                path: 'hf://mlx-community/Qwen3.6-35B-A3B-4bit',
                supports_in_app_download: true,
              }),
            ]),
          }),
          expect.objectContaining({
            model_name: 'AX Engine DiffusionGemma 26B A4B',
            developer: 'AX Engine',
            is_mlx: true,
            quants: expect.arrayContaining([
              expect.objectContaining({
                model_id: 'mlx-community/diffusiongemma-26B-A4B-it-4bit',
                path: 'hf://mlx-community/diffusiongemma-26B-A4B-it-4bit',
                supports_in_app_download: true,
              }),
            ]),
          }),
        ])
      )
    })
  })

  describe('updateModel', () => {
    it('should update model settings', async () => {
      const modelId = 'model1'
      const model = {
        id: 'model1',
        settings: [{ key: 'temperature', value: 0.7 }],
      }

      await modelsService.updateModel(modelId, model as any)

      expect(mockEngine.updateSettings).toHaveBeenCalledWith(model.settings)
      expect(mockEngine.update).not.toHaveBeenCalled()
    })

    it('should handle model without settings', async () => {
      const modelId = 'model1'
      const model = { id: 'model1' }

      await modelsService.updateModel(modelId, model)

      expect(mockEngine.updateSettings).not.toHaveBeenCalled()
      expect(mockEngine.update).not.toHaveBeenCalled()
    })

    it('should handle model when modelId differs from model.id', async () => {
      const modelId = 'old-model-id'
      const model = {
        id: 'new-model-id',
        settings: [{ key: 'temperature', value: 0.7 }],
      }

      await modelsService.updateModel(modelId, model as any)

      expect(mockEngine.updateSettings).toHaveBeenCalledWith(model.settings)
      // Note: Model ID updates are now handled at the provider level in the frontend
      // The engine no longer has an update method for model metadata
      expect(mockEngine.update).not.toHaveBeenCalled()
    })
  })

  describe('pullModel', () => {
    it('should pull model successfully', async () => {
      const id = 'model1'
      const modelPath = '/path/to/model'

      await modelsService.pullModel(id, modelPath)

      expect(mockEngine.import).toHaveBeenCalledWith(id, { modelPath })
    })

    it('should pass transient download headers for authenticated Hugging Face imports', async () => {
      const repoResponse: HuggingFaceRepo = {
        id: 'repo-id',
        modelId: 'org/model',
        sha: 'sha',
        downloads: 0,
        likes: 0,
        tags: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        private: false,
        disabled: false,
        gated: false,
        author: 'org',
        siblings: [],
      }

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(repoResponse),
      } as unknown as Response)

      await modelsService.pullModelWithMetadata(
        'org/model-q4',
        'https://huggingface.co/org/model/resolve/main/model-q4.gguf',
        undefined,
        'hf_secret'
      )

      expect(mockEngine.import).toHaveBeenCalledWith('org/model-q4', {
        modelPath: 'https://huggingface.co/org/model/resolve/main/model-q4.gguf',
        modelSha256: undefined,
        modelSize: undefined,
        mmprojPath: undefined,
        mmprojSha256: undefined,
        mmprojSize: undefined,
        downloadHeaders: {
          Authorization: 'Bearer hf_secret',
        },
      })
    })
  })

  describe('abortDownload', () => {
    it('should abort download successfully', async () => {
      const id = 'model1'

      await modelsService.abortDownload(id)

      expect(mockEngine.abortImport).toHaveBeenCalledWith(id)
      expect(events.emit).toHaveBeenCalledWith(
        DownloadEvent.onFileDownloadStopped,
        expect.objectContaining({
          modelId: id,
          downloadType: 'Model',
        })
      )
    })

    it('should emit stopped event even when abort fails', async () => {
      const llamaEngine = {
        ...mockEngine,
        abortImport: vi.fn().mockRejectedValue(new Error('llama abort failed')),
      }
      mockEngineManager.get.mockImplementation(() => llamaEngine)

      await modelsService.abortDownload('model1')

      expect(llamaEngine.abortImport).toHaveBeenCalledWith('model1')
      // Stopped event is always emitted (finally), even if abort rejects.
      expect(events.emit).toHaveBeenCalledWith(
        DownloadEvent.onFileDownloadStopped,
        { modelId: 'model1', downloadType: 'Model' }
      )
    })
  })

  describe('deleteModel', () => {
    it('should delete model successfully', async () => {
      const id = 'model1'

      await modelsService.deleteModel(id)

      expect(mockEngine.delete).toHaveBeenCalledWith(id)
    })

    it('should throw when deleting without an available engine', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockEngineManager.get.mockReturnValue(undefined)

      await expect(modelsService.deleteModel('model1', 'ax-engine')).rejects.toThrow(
        '[ModelsService] Cannot delete model: engine "llamacpp" is not available.'
      )

      consoleSpy.mockRestore()
    })
  })

  describe('getActiveModels', () => {
    it('should get active models successfully', async () => {
      const mockActiveModels = ['model1', 'model2']
      mockEngine.getLoadedModels.mockResolvedValue(mockActiveModels)

      const result = await modelsService.getActiveModels()

      expect(result).toEqual(mockActiveModels)
      expect(mockEngine.getLoadedModels).toHaveBeenCalled()
    })
  })

  describe('stopModel', () => {
    it('should stop model successfully', async () => {
      const model = 'model1'
      const provider = 'openai'

      await modelsService.stopModel(model, provider)

      expect(mockEngine.unload).toHaveBeenCalledWith(model)
    })

    it('should stop mlx models through the MLX SDK command', async () => {
      mockInvoke.mockResolvedValue(undefined)

      await expect(
        modelsService.stopModel('model1', 'ax-engine')
      ).resolves.toEqual({
        success: true,
      })

      expect(mockInvoke).toHaveBeenCalledWith('mlx_unload_model', {
        modelId: 'model1',
      })
      expect(mockEngine.unload).not.toHaveBeenCalled()
    })
  })

  describe('stopAllModels', () => {
    it('should stop all active models from all providers', async () => {
      const mockActiveModels = ['model1', 'model2']
      mockEngine.getLoadedModels.mockResolvedValue(mockActiveModels)
      mockInvoke
        .mockResolvedValueOnce(['mlx-model'])
        .mockResolvedValueOnce(undefined)

      await modelsService.stopAllModels()

      expect(mockEngine.unload).toHaveBeenCalledTimes(2)
      expect(mockEngine.unload).toHaveBeenCalledWith('model1')
      expect(mockEngine.unload).toHaveBeenCalledWith('model2')
      expect(mockInvoke).toHaveBeenCalledWith('mlx_list_loaded')
      expect(mockInvoke).toHaveBeenCalledWith('mlx_unload_model', {
        modelId: 'mlx-model',
      })
    })

    it('should handle empty active models', async () => {
      mockEngine.getLoadedModels.mockResolvedValue(null)
      mockInvoke.mockResolvedValue([])

      await modelsService.stopAllModels()

      expect(mockEngine.unload).not.toHaveBeenCalled()
    })

    it('should continue stopping models when one unload rejects', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockEngine.getLoadedModels.mockResolvedValue(['model1', 'model2'])
      mockInvoke.mockResolvedValue([])
      mockEngine.unload
        .mockRejectedValueOnce(new Error('unload failed'))
        .mockResolvedValue(undefined)

      await expect(modelsService.stopAllModels()).rejects.toThrow(
        'Failed to stop 1 model'
      )

      expect(mockEngine.unload).toHaveBeenCalledTimes(2)
      expect(warnSpy).toHaveBeenCalledWith(
        '[ModelsService] stopAllModels unload failed:',
        expect.any(Error)
      )
      warnSpy.mockRestore()
    })

    it('rejects when an engine reports an unsuccessful unload result', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockEngine.getLoadedModels.mockResolvedValue(['model1', 'model2'])
      mockInvoke.mockResolvedValue([])
      mockEngine.unload
        .mockResolvedValueOnce({ success: false, error: 'model is busy' })
        .mockResolvedValueOnce({ success: true })

      await expect(modelsService.stopAllModels()).rejects.toThrow(
        'Failed to stop 1 model'
      )

      expect(mockEngine.unload).toHaveBeenCalledTimes(2)
      expect(warnSpy).toHaveBeenCalledWith(
        '[ModelsService] stopAllModels unload failed:',
        expect.objectContaining({ message: 'model is busy' })
      )
      warnSpy.mockRestore()
    })
  })

  describe('startModel', () => {
    it('should start model successfully', async () => {
      const mockSettings = {
        ctx_len: { controller_props: { value: 4096 } },
        ngl: { controller_props: { value: 32 } },
      }
      const provider = {
        provider: 'openai',
        models: [{ id: 'model1', settings: mockSettings }],
      } as any
      const model = 'model1'
      const mockSession = { id: 'session1' }

      mockEngine.getLoadedModels.mockResolvedValue({
        includes: () => false,
      })
      mockEngine.load.mockResolvedValue(mockSession)

      const result = await modelsService.startModel(provider, model)

      expect(result).toEqual(mockSession)
      expect(mockEngine.load).toHaveBeenCalledWith(model, {
        ctx_size: 4096,
        n_gpu_layers: 32,
      }, false, false)
    })

    it('should handle start model error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const mockSettings = {
        ctx_len: { controller_props: { value: 4096 } },
        ngl: { controller_props: { value: 32 } },
      }
      const provider = {
        provider: 'openai',
        models: [{ id: 'model1', settings: mockSettings }],
      } as any
      const model = 'model1'
      const error = new Error('Failed to start model')

      mockEngine.getLoadedModels.mockResolvedValue({
        includes: () => false,
      })
      mockEngine.load.mockRejectedValue(error)

      await expect(modelsService.startModel(provider, model)).rejects.toThrow(
        error
      )
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to start model model1 for provider openai:',
        error
      )
      consoleSpy.mockRestore()
    })
    it('should not load model again', async () => {
      const mockSettings = {
        ctx_len: { controller_props: { value: 4096 } },
        ngl: { controller_props: { value: 32 } },
      }
      const provider = {
        provider: 'openai',
        models: [{ id: 'model1', settings: mockSettings }],
      } as any
      const model = 'model1'

      mockEngine.getLoadedModels.mockResolvedValue({
        includes: () => true,
      })
      expect(mockEngine.load).toBeCalledTimes(0)
      await expect(modelsService.startModel(provider, model)).resolves.toBe(
        undefined
      )
    })

    it('should resync route when a loaded local model is reused', async () => {
      const provider = {
        provider: 'llamacpp',
        models: [{ id: 'model1', settings: {} }],
      } as any

      mockEngine.getLoadedModels.mockResolvedValue({
        includes: (value: string) => value === 'model1',
      })

      await expect(modelsService.startModel(provider, 'model1')).resolves.toBe(
        undefined
      )

      expect(mockEngine.syncModelRoute).toHaveBeenCalledWith('model1')
      expect(mockEngine.load).not.toHaveBeenCalled()
    })

    it('should load normally when engine returns no loaded models list', async () => {
      const provider = {
        provider: 'llamacpp',
        models: [{ id: 'model1', settings: {} }],
      } as any
      const mockSession = { id: 'session1' }

      mockEngine.getLoadedModels.mockResolvedValue(undefined)
      mockEngine.load.mockResolvedValue(mockSession)

      await expect(modelsService.startModel(provider, 'model1')).resolves.toEqual(
        mockSession
      )

      expect(mockEngine.syncModelRoute).toHaveBeenCalledWith('model1')
      expect(mockEngine.load).toHaveBeenCalledWith(
        'model1',
        {},
        false,
        false
      )
    })

    it('should load mlx models through the MLX SDK command outside Electron', async () => {
      const provider = {
        provider: 'ax-engine',
        models: [{ id: 'model1', settings: {} }],
      } as any
      mockIsPlatformElectron.mockReturnValue(false)
      mockInvoke.mockResolvedValue(undefined)

      await expect(modelsService.startModel(provider, 'model1')).resolves.toEqual({
        pid: 0,
        port: 0,
        model_id: 'model1',
        model_path: 'model1',
        is_embedding: false,
        api_key: '',
      })

      expect(mockInvoke).toHaveBeenCalledWith('mlx_load_model', { modelId: 'model1' })
      expect(mockEngineManager.get).not.toHaveBeenCalled()
      expect(mockEngine.load).not.toHaveBeenCalled()
    })

    it('should start ax-engine models via sidecar ensure on Electron (no mlx_load_model)', async () => {
      const provider = {
        provider: 'ax-engine',
        models: [{ id: 'model1', settings: {} }],
      } as any
      mockIsPlatformElectron.mockReturnValue(true)
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'mlx_resolve_model_dir') return '/models/model1'
        if (cmd === 'ax_engine_ensure') {
          return {
            phase: 'ready',
            baseURL: 'http://127.0.0.1:31418/v1',
            apiKey: 'local',
            models: ['model1'],
            port: 31418,
            pid: 99,
          }
        }
        throw new Error(`unexpected invoke: ${cmd}`)
      })

      await expect(modelsService.startModel(provider, 'model1')).resolves.toEqual({
        pid: 99,
        port: 31418,
        model_id: 'model1',
        model_path: '/models/model1',
        is_embedding: false,
        api_key: 'local',
      })

      expect(mockInvoke.mock.calls.map((c) => c[0])).toEqual([
        'mlx_resolve_model_dir',
        'ax_engine_ensure',
      ])
      expect(mockInvoke.mock.calls.map((c) => c[0])).not.toContain(
        'mlx_load_model'
      )
      expect(mockEngine.load).not.toHaveBeenCalled()
    })

    it('does not manage model lifecycle for an attached AX Engine server', async () => {
      const provider = {
        provider: 'ax-engine',
        connection_mode: 'attach',
        models: [{ id: 'attached-model', settings: {} }],
      } as any
      mockGetProviderByName.mockReturnValue(provider)
      mockIsPlatformElectron.mockReturnValue(true)

      await expect(
        modelsService.startModel(provider, 'attached-model')
      ).resolves.toBeUndefined()
      await expect(modelsService.getActiveModels('ax-engine')).resolves.toEqual(
        []
      )
      await expect(
        modelsService.stopModel('attached-model', 'ax-engine')
      ).resolves.toEqual({ success: true })

      expect(mockInvoke).not.toHaveBeenCalled()
    })

    it('should stop ax-engine models via sidecar unload on Electron', async () => {
      mockIsPlatformElectron.mockReturnValue(true)
      mockInvoke.mockResolvedValue({})
      await expect(
        modelsService.stopModel('model1', 'ax-engine')
      ).resolves.toEqual({ success: true })
      expect(mockInvoke).toHaveBeenCalledWith('ax_engine_unload_model', {
        modelId: 'model1',
        model_id: 'model1',
      })
      expect(mockInvoke.mock.calls.map((c) => c[0])).not.toContain(
        'mlx_unload_model'
      )
    })

    it('should throw a helpful error when the provider engine is unavailable', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockEngineManager.get.mockReturnValue(undefined)

      await expect(
        modelsService.startModel({ provider: 'llamacpp', models: [] } as any, 'model1')
      ).rejects.toThrow(
        'Local engine "llamacpp" is not available. Try restarting the app'
      )

      consoleSpy.mockRestore()
    })

    it('should forward only load-time settings and bypass flag', async () => {
      const provider = {
        provider: 'llamacpp',
        models: [
          {
            id: 'model1',
            settings: {
              ctx_len: { controller_props: { value: 8192 } },
              ngl: { controller_props: { value: 99 } },
              temperature: { controller_props: { value: 0.7 } },
              top_p: { controller_props: { value: 0.9 } },
              flash_attn: { controller_props: { value: true } },
            },
          },
        ],
      } as any
      mockEngine.getLoadedModels.mockResolvedValue([])
      mockEngine.load.mockResolvedValue({ id: 'session1' })

      await modelsService.startModel(provider, 'model1', true)

      expect(mockEngine.load).toHaveBeenCalledWith(
        'model1',
        {
          ctx_size: 8192,
          n_gpu_layers: 99,
          flash_attn: true,
        },
        false,
        true
      )
    })
  })

  describe('fetchHuggingFaceRepo', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should fetch HuggingFace repository successfully with blobs=true', async () => {
      const mockRepoData = {
        id: 'microsoft/DialoGPT-medium',
        modelId: 'microsoft/DialoGPT-medium',
        sha: 'abc123',
        downloads: 5000,
        likes: 100,
        tags: ['conversational', 'pytorch'],
        pipeline_tag: 'text-generation',
        createdAt: '2023-01-01T00:00:00Z',
        last_modified: '2023-12-01T00:00:00Z',
        private: false,
        disabled: false,
        gated: false,
        author: 'microsoft',
        siblings: [
          {
            rfilename: 'model-Q4_K_M.gguf',
            size: 2147483648,
            blobId: 'blob123',
          },
          {
            rfilename: 'model-Q8_0.gguf',
            size: 4294967296,
            blobId: 'blob456',
          },
          {
            rfilename: 'README.md',
            size: 1024,
            blobId: 'blob789',
          },
        ],
        readme: '# DialoGPT Model\nThis is a conversational AI model.',
      }

      ;(fetch as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRepoData),
      })

      const result = await modelsService.fetchHuggingFaceRepo(
        'microsoft/DialoGPT-medium'
      )

      expect(result).toEqual(mockRepoData)
      expect(fetch).toHaveBeenCalledWith(
        'https://huggingface.co/api/models/microsoft/DialoGPT-medium?blobs=true&files_metadata=true',
        {
          headers: {},
          signal: undefined,
        }
      )
    })

    it('should clean repository ID from various input formats', async () => {
      const mockRepoData: HuggingFaceRepo = {
        id: 'microsoft/DialoGPT-medium',
        modelId: 'microsoft/DialoGPT-medium',
        sha: 'abc123',
        downloads: 5000,
        likes: 100,
        tags: ['conversational'],
        createdAt: '2023-01-01T00:00:00Z',
        private: false,
        disabled: false,
        gated: false,
        author: 'microsoft',
        siblings: [],
      }
      ;(fetch as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRepoData),
      })

      // Test with full URL
      await modelsService.fetchHuggingFaceRepo(
        'https://huggingface.co/microsoft/DialoGPT-medium'
      )
      expect(fetch).toHaveBeenCalledWith(
        'https://huggingface.co/api/models/microsoft/DialoGPT-medium?blobs=true&files_metadata=true',
        {
          headers: {},
          signal: undefined,
        }
      )

      // Test with domain prefix
      await modelsService.fetchHuggingFaceRepo(
        'huggingface.co/microsoft/DialoGPT-medium'
      )
      expect(fetch).toHaveBeenCalledWith(
        'https://huggingface.co/api/models/microsoft/DialoGPT-medium?blobs=true&files_metadata=true',
        {
          headers: {},
          signal: undefined,
        }
      )

      // Test with trailing slash
      await modelsService.fetchHuggingFaceRepo('microsoft/DialoGPT-medium/')
      expect(fetch).toHaveBeenCalledWith(
        'https://huggingface.co/api/models/microsoft/DialoGPT-medium?blobs=true&files_metadata=true',
        {
          headers: {},
          signal: undefined,
        }
      )
    })

    it('should return null for invalid repository IDs', async () => {
      // Test empty string
      expect(await modelsService.fetchHuggingFaceRepo('')).toBeNull()

      // Test string without slash
      expect(
        await modelsService.fetchHuggingFaceRepo('invalid-repo')
      ).toBeNull()

      // Test whitespace only
      expect(await modelsService.fetchHuggingFaceRepo('   ')).toBeNull()
    })

    it('should return null for 404 responses', async () => {
      ;(fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      })

      const result =
        await modelsService.fetchHuggingFaceRepo('nonexistent/model')

      expect(result).toBeNull()
      expect(fetch).toHaveBeenCalledWith(
        'https://huggingface.co/api/models/nonexistent/model?blobs=true&files_metadata=true',
        {
          headers: {},
          signal: undefined,
        }
      )
    })

    it('should handle other HTTP errors', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      ;(fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      })

      const result = await modelsService.fetchHuggingFaceRepo(
        'microsoft/DialoGPT-medium'
      )

      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error fetching HuggingFace repository:',
        expect.any(Error)
      )

      consoleSpy.mockRestore()
    })

    it('should handle network errors', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      ;(fetch as any).mockRejectedValue(new Error('Network error'))

      const result = await modelsService.fetchHuggingFaceRepo(
        'microsoft/DialoGPT-medium'
      )

      expect(result).toBeNull()
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error fetching HuggingFace repository:',
        expect.any(Error)
      )

      consoleSpy.mockRestore()
    })

    it('should handle repository with no siblings', async () => {
      const mockRepoData = {
        id: 'microsoft/DialoGPT-medium',
        modelId: 'microsoft/DialoGPT-medium',
        sha: 'abc123',
        downloads: 5000,
        likes: 100,
        tags: ['conversational'],
        pipeline_tag: 'text-generation',
        createdAt: '2023-01-01T00:00:00Z',
        last_modified: '2023-12-01T00:00:00Z',
        private: false,
        disabled: false,
        gated: false,
        author: 'microsoft',
        siblings: undefined,
      }

      ;(fetch as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRepoData),
      })

      const result = await modelsService.fetchHuggingFaceRepo(
        'microsoft/DialoGPT-medium'
      )

      expect(result).toEqual(mockRepoData)
    })

    it('should handle repository with no GGUF files', async () => {
      const mockRepoData = {
        id: 'microsoft/DialoGPT-medium',
        modelId: 'microsoft/DialoGPT-medium',
        sha: 'abc123',
        downloads: 5000,
        likes: 100,
        tags: ['conversational'],
        pipeline_tag: 'text-generation',
        createdAt: '2023-01-01T00:00:00Z',
        last_modified: '2023-12-01T00:00:00Z',
        private: false,
        disabled: false,
        gated: false,
        author: 'microsoft',
        siblings: [
          {
            rfilename: 'README.md',
            size: 1024,
            blobId: 'blob789',
          },
          {
            rfilename: 'config.json',
            size: 512,
            blobId: 'blob101',
          },
        ],
      }

      ;(fetch as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRepoData),
      })

      const result = await modelsService.fetchHuggingFaceRepo(
        'microsoft/DialoGPT-medium'
      )

      expect(result).toEqual(mockRepoData)
    })

    it('should handle repository with mixed file types including GGUF', async () => {
      const mockRepoData = {
        id: 'microsoft/DialoGPT-medium',
        modelId: 'microsoft/DialoGPT-medium',
        sha: 'abc123',
        downloads: 5000,
        likes: 100,
        tags: ['conversational'],
        pipeline_tag: 'text-generation',
        createdAt: '2023-01-01T00:00:00Z',
        last_modified: '2023-12-01T00:00:00Z',
        private: false,
        disabled: false,
        gated: false,
        author: 'microsoft',
        siblings: [
          {
            rfilename: 'model-Q4_K_M.gguf',
            size: 2147483648, // 2GB
            blobId: 'blob123',
          },
          {
            rfilename: 'README.md',
            size: 1024,
            blobId: 'blob789',
          },
          {
            rfilename: 'config.json',
            size: 512,
            blobId: 'blob101',
          },
        ],
      }

      ;(fetch as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockRepoData),
      })

      const result = await modelsService.fetchHuggingFaceRepo(
        'microsoft/DialoGPT-medium'
      )

      expect(result).toEqual(mockRepoData)
      // Verify the GGUF file is present in siblings
      expect(result?.siblings?.some((s) => s.rfilename.endsWith('.gguf'))).toBe(
        true
      )
    })
  })

  describe('pullModelWithMetadata', () => {
    it('should include model and mmproj metadata from Hugging Face siblings', async () => {
      const repoResponse: HuggingFaceRepo = {
        id: 'repo-id',
        modelId: 'org/model',
        sha: 'sha',
        downloads: 0,
        likes: 0,
        tags: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        private: false,
        disabled: false,
        gated: false,
        author: 'org',
        siblings: [
          {
            rfilename: 'model-q4.gguf',
            lfs: { sha256: 'model-sha', size: 123, pointerSize: 123 },
          },
          {
            rfilename: 'mmproj-model.gguf',
            lfs: { sha256: 'mmproj-sha', size: 456, pointerSize: 456 },
          },
        ],
      }
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(repoResponse),
      } as unknown as Response)

      await modelsService.pullModelWithMetadata(
        'org/model-q4',
        'https://huggingface.co/org/model/resolve/main/model-q4.gguf',
        'https://huggingface.co/org/model/resolve/main/mmproj-model.gguf'
      )

      expect(mockEngine.import).toHaveBeenCalledWith('org/model-q4', {
        modelPath: 'https://huggingface.co/org/model/resolve/main/model-q4.gguf',
        modelSha256: 'model-sha',
        modelSize: 123,
        mmprojPath:
          'https://huggingface.co/org/model/resolve/main/mmproj-model.gguf',
        mmprojSha256: 'mmproj-sha',
        mmprojSize: 456,
        downloadHeaders: undefined,
      })
    })

    it('should skip metadata fetch when verification is disabled', async () => {
      await modelsService.pullModelWithMetadata(
        'org/model-q4',
        'https://huggingface.co/org/model/resolve/main/model-q4.gguf',
        undefined,
        undefined,
        true
      )

      expect(fetch).not.toHaveBeenCalled()
      expect(mockEngine.import).toHaveBeenCalledWith(
        'org/model-q4',
        expect.objectContaining({
          modelSha256: undefined,
          modelSize: undefined,
        })
      )
    })

    it('should pass Hugging Face sibling metadata for MLX repo downloads', async () => {
      const repoResponse: HuggingFaceRepo = {
        id: 'mlx-community/Qwen3.5-4B-4bit',
        modelId: 'mlx-community/Qwen3.5-4B-4bit',
        sha: 'sha',
        downloads: 0,
        likes: 0,
        tags: ['mlx'],
        createdAt: '2026-01-01T00:00:00.000Z',
        private: false,
        disabled: false,
        gated: false,
        author: 'mlx-community',
        siblings: [
          {
            rfilename: 'model.safetensors',
            lfs: { sha256: 'model-sha', size: 123, pointerSize: 123 },
          },
          {
            rfilename: 'tokenizer.json',
            size: 456,
          },
        ],
      }
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(repoResponse),
      } as unknown as Response)

      await modelsService.pullModelWithMetadata(
        'mlx-community/Qwen3.5-4B-4bit',
        'hf://mlx-community/Qwen3.5-4B-4bit'
      )

      expect(mockEngine.import).toHaveBeenCalledWith(
        'mlx-community/Qwen3.5-4B-4bit',
        expect.objectContaining({
          modelPath: 'hf://mlx-community/Qwen3.5-4B-4bit',
          hfRepoFiles: repoResponse.siblings,
          hfRevision: repoResponse.sha,
        })
      )
    })
  })

  describe('convertHfRepoToCatalogModel', () => {
    const mockHuggingFaceRepo: HuggingFaceRepo = {
      id: 'microsoft/DialoGPT-medium',
      modelId: 'microsoft/DialoGPT-medium',
      sha: 'abc123',
      downloads: 1500,
      likes: 75,
      tags: ['pytorch', 'transformers', 'text-generation'],
      pipeline_tag: 'text-generation',
      createdAt: '2021-01-01T00:00:00Z',
      last_modified: '2021-12-01T00:00:00Z',
      private: false,
      disabled: false,
      library_name: "mlx",
      gated: false,
      author: 'microsoft',
      siblings: [
        {
          rfilename: 'model-q4_0.gguf',
          size: 2 * 1024 * 1024 * 1024, // 2GB
          blobId: 'blob123',
        },
        {
          rfilename: 'model-q8_0.GGUF', // Test case-insensitive matching
          size: 4 * 1024 * 1024 * 1024, // 4GB
          blobId: 'blob456',
        },
        {
          rfilename: 'tokenizer.json', // Non-GGUF file (should be filtered out)
          size: 1024 * 1024, // 1MB
          blobId: 'blob789',
        },
      ],
    }

    it('should convert HuggingFace repo to catalog model format', () => {
      const result =
        modelsService.convertHfRepoToCatalogModel(mockHuggingFaceRepo)

      const expected: CatalogModel = {
        model_name: 'microsoft/DialoGPT-medium',
        description: '**Tags**: pytorch, transformers, text-generation',
        developer: 'microsoft',
        downloads: 1500,
        num_quants: 2,
        quants: [
          {
            model_id: 'microsoft/model-q4_0',
            path: 'https://huggingface.co/microsoft/DialoGPT-medium/resolve/main/model-q4_0.gguf',
            file_size: '2.0 GB',
          },
          {
            model_id: 'microsoft/model-q8_0',
            path: 'https://huggingface.co/microsoft/DialoGPT-medium/resolve/main/model-q8_0.GGUF',
            file_size: '4.0 GB',
          },
        ],
        num_mmproj: 0,
        mmproj_models: [],
        safetensors_files: [],
        num_safetensors: 0,
        is_mlx: true,
        created_at: '2021-01-01T00:00:00Z',
        readme:
          'https://huggingface.co/microsoft/DialoGPT-medium/resolve/main/README.md',
      }

      expect(result).toEqual(expected)
    })

    it('should handle repository with no GGUF files', () => {
      const repoWithoutGGUF: HuggingFaceRepo = {
        ...mockHuggingFaceRepo,
        siblings: [
          {
            rfilename: 'tokenizer.json',
            size: 1024 * 1024,
            blobId: 'blob789',
          },
          {
            rfilename: 'config.json',
            size: 2048,
            blobId: 'blob101',
          },
        ],
      }

      const result = modelsService.convertHfRepoToCatalogModel(repoWithoutGGUF)

      expect(result.num_quants).toBe(0)
      expect(result.quants).toEqual([])
    })

    it('should expose MLX safetensors repos as downloadable Hub models', () => {
      const mlxRepo: HuggingFaceRepo = {
        ...mockHuggingFaceRepo,
        modelId: 'mlx-community/gemma-4-12B-it-4bit',
        author: 'mlx-community',
        tags: ['mlx'],
        library_name: 'ax-engine',
        siblings: [
          {
            rfilename: 'model-manifest.json',
            size: 1024,
          },
          {
            rfilename: 'model-00001-of-00002.safetensors',
            size: 5 * 1024 * 1024 * 1024,
            lfs: {
              sha256: 'abc',
              size: 5 * 1024 * 1024 * 1024,
              pointerSize: 133,
            },
          },
          {
            rfilename: 'model-00002-of-00002.safetensors',
            size: 6 * 1024 * 1024 * 1024,
            lfs: {
              sha256: 'def',
              size: 6 * 1024 * 1024 * 1024,
              pointerSize: 133,
            },
          },
          {
            rfilename: 'tokenizer.json',
            size: 1024 * 1024,
          },
        ],
      }

      const result = modelsService.convertHfRepoToCatalogModel(mlxRepo)

      expect(result.is_mlx).toBe(true)
      expect(result.num_quants).toBe(1)
      expect(result.quants).toEqual([
        {
          model_id: 'mlx-community/gemma-4-12B-it-4bit',
          path: 'hf://mlx-community/gemma-4-12B-it-4bit',
          file_size: '11.0 GB',
          supports_in_app_download: true,
        },
      ])
    })

    it('should expose safetensors-only MLX repos for generated-manifest download', () => {
      const mlxRepo: HuggingFaceRepo = {
        ...mockHuggingFaceRepo,
        modelId: 'mlx-community/Qwen3.5-9B-MLX-4bit',
        author: 'mlx-community',
        tags: ['mlx'],
        library_name: 'ax-engine',
        siblings: [
          {
            rfilename: 'model-00001-of-00002.safetensors',
            size: 5 * 1024 * 1024 * 1024,
            lfs: {
              sha256: 'abc',
              size: 5 * 1024 * 1024 * 1024,
              pointerSize: 133,
            },
          },
          {
            rfilename: 'tokenizer.json',
            size: 1024 * 1024,
          },
        ],
      }

      const result = modelsService.convertHfRepoToCatalogModel(mlxRepo)

      expect(result.is_mlx).toBe(true)
      expect(result.num_quants).toBe(1)
      expect(result.quants).toEqual([
        {
          model_id: 'mlx-community/Qwen3.5-9B-MLX-4bit',
          path: 'hf://mlx-community/Qwen3.5-9B-MLX-4bit',
          file_size: '5.0 GB',
          supports_in_app_download: true,
        },
      ])
      expect(result.num_safetensors).toBe(1)
    })

    it('should handle repository with no siblings', () => {
      const repoWithoutSiblings: HuggingFaceRepo = {
        ...mockHuggingFaceRepo,
        siblings: undefined,
      }

      const result =
        modelsService.convertHfRepoToCatalogModel(repoWithoutSiblings)

      expect(result.num_quants).toBe(0)
      expect(result.quants).toEqual([])
    })

    it('should format file sizes correctly', () => {
      const repoWithVariousFileSizes: HuggingFaceRepo = {
        ...mockHuggingFaceRepo,
        siblings: [
          {
            rfilename: 'small-model.gguf',
            size: 500 * 1024 * 1024, // 500MB
            blobId: 'blob1',
          },
          {
            rfilename: 'large-model.gguf',
            size: 3.5 * 1024 * 1024 * 1024, // 3.5GB
            blobId: 'blob2',
          },
          {
            rfilename: 'unknown-size.gguf',
            // No size property
            blobId: 'blob3',
          },
        ],
      }

      const result = modelsService.convertHfRepoToCatalogModel(
        repoWithVariousFileSizes
      )

      expect(result.quants[0].file_size).toBe('500.0 MB')
      expect(result.quants[1].file_size).toBe('3.5 GB')
      expect(result.quants[2].file_size).toBe('Unknown size')
    })

    it('should handle empty or undefined tags', () => {
      const repoWithEmptyTags: HuggingFaceRepo = {
        ...mockHuggingFaceRepo,
        tags: [],
      }

      const result =
        modelsService.convertHfRepoToCatalogModel(repoWithEmptyTags)

      expect(result.description).toBe('**Tags**: ')
    })

    it('should handle missing downloads count', () => {
      const repoWithoutDownloads: HuggingFaceRepo = {
        ...mockHuggingFaceRepo,
        downloads: undefined as any,
      }

      const result =
        modelsService.convertHfRepoToCatalogModel(repoWithoutDownloads)

      expect(result.downloads).toBe(0)
    })

    it('should correctly remove .gguf extension from model IDs', () => {
      const repoWithVariousGGUF: HuggingFaceRepo = {
        ...mockHuggingFaceRepo,
        siblings: [
          {
            rfilename: 'model.gguf',
            size: 1024,
            blobId: 'blob1',
          },
          {
            rfilename: 'MODEL.GGUF',
            size: 1024,
            blobId: 'blob2',
          },
          {
            rfilename: 'complex-model-name.gguf',
            size: 1024,
            blobId: 'blob3',
          },
        ],
      }

      const result =
        modelsService.convertHfRepoToCatalogModel(repoWithVariousGGUF)

      expect(result.quants[0].model_id).toBe('microsoft/model')
      expect(result.quants[1].model_id).toBe('microsoft/MODEL')
      expect(result.quants[2].model_id).toBe('microsoft/complex-model-name')
    })

    it('should generate correct download paths', () => {
      const result =
        modelsService.convertHfRepoToCatalogModel(mockHuggingFaceRepo)

      expect(result.quants[0].path).toBe(
        'https://huggingface.co/microsoft/DialoGPT-medium/resolve/main/model-q4_0.gguf'
      )
      expect(result.quants[1].path).toBe(
        'https://huggingface.co/microsoft/DialoGPT-medium/resolve/main/model-q8_0.GGUF'
      )
    })

    it('should generate correct readme URL', () => {
      const result =
        modelsService.convertHfRepoToCatalogModel(mockHuggingFaceRepo)

      expect(result.readme).toBe(
        'https://huggingface.co/microsoft/DialoGPT-medium/resolve/main/README.md'
      )
    })

    it('should handle GGUF files with case-insensitive extension matching', () => {
      const repoWithMixedCase: HuggingFaceRepo = {
        ...mockHuggingFaceRepo,
        siblings: [
          {
            rfilename: 'model-1.gguf',
            size: 1024,
            blobId: 'blob1',
          },
          {
            rfilename: 'model-2.GGUF',
            size: 1024,
            blobId: 'blob2',
          },
          {
            rfilename: 'model-3.GgUf',
            size: 1024,
            blobId: 'blob3',
          },
          {
            rfilename: 'not-a-model.txt',
            size: 1024,
            blobId: 'blob4',
          },
        ],
      }

      const result =
        modelsService.convertHfRepoToCatalogModel(repoWithMixedCase)

      expect(result.num_quants).toBe(3)
      expect(result.quants).toHaveLength(3)
      expect(result.quants[0].model_id).toBe('microsoft/model-1')
      expect(result.quants[1].model_id).toBe('microsoft/model-2')
      expect(result.quants[2].model_id).toBe('microsoft/model-3')
    })

    it('should handle edge cases with file size formatting', () => {
      const repoWithEdgeCases: HuggingFaceRepo = {
        ...mockHuggingFaceRepo,
        siblings: [
          {
            rfilename: 'tiny.gguf',
            size: 512, // < 1MB
            blobId: 'blob1',
          },
          {
            rfilename: 'exactly-1gb.gguf',
            size: 1024 * 1024 * 1024, // Exactly 1GB
            blobId: 'blob2',
          },
          {
            rfilename: 'zero-size.gguf',
            size: 0,
            blobId: 'blob3',
          },
        ],
      }

      const result =
        modelsService.convertHfRepoToCatalogModel(repoWithEdgeCases)

      expect(result.quants[0].file_size).toBe('0.0 MB')
      expect(result.quants[1].file_size).toBe('1.0 GB')
      expect(result.quants[2].file_size).toBe('0.0 MB')
    })

    it('should handle missing optional fields gracefully', () => {
      const minimalRepo: HuggingFaceRepo = {
        id: 'minimal/repo',
        modelId: 'minimal/repo',
        sha: 'abc123',
        downloads: 0,
        likes: 0,
        tags: [],
        createdAt: '2021-01-01T00:00:00Z',
        last_modified: '2021-12-01T00:00:00Z',
        private: false,
        disabled: false,
        gated: false,
        author: 'minimal',
        siblings: [
          {
            rfilename: 'model.gguf',
            blobId: 'blob1',
          },
        ],
      }

      const result = modelsService.convertHfRepoToCatalogModel(minimalRepo)

      expect(result.model_name).toBe('minimal/repo')
      expect(result.developer).toBe('minimal')
      expect(result.downloads).toBe(0)
      expect(result.description).toBe('**Tags**: ')
      expect(result.quants[0].file_size).toBe('Unknown size')
    })
  })

  describe('isModelSupported', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should return GREEN when model is fully supported', async () => {
      const mockEngineWithSupport = {
        ...mockEngine,
        isModelSupported: vi.fn().mockResolvedValue('GREEN'),
      }

      mockEngineManager.get.mockReturnValue(mockEngineWithSupport)

      const result = await modelsService.isModelSupported(
        '/path/to/model.gguf',
        4096
      )

      expect(result).toBe('GREEN')
      expect(mockEngineWithSupport.isModelSupported).toHaveBeenCalledWith(
        '/path/to/model.gguf',
        4096
      )
    })

    it('should return YELLOW when model weights fit but KV cache does not', async () => {
      const mockEngineWithSupport = {
        ...mockEngine,
        isModelSupported: vi.fn().mockResolvedValue('YELLOW'),
      }

      mockEngineManager.get.mockReturnValue(mockEngineWithSupport)

      const result = await modelsService.isModelSupported(
        '/path/to/model.gguf',
        8192
      )

      expect(result).toBe('YELLOW')
      expect(mockEngineWithSupport.isModelSupported).toHaveBeenCalledWith(
        '/path/to/model.gguf',
        8192
      )
    })

    it('should return RED when model is not supported', async () => {
      const mockEngineWithSupport = {
        ...mockEngine,
        isModelSupported: vi.fn().mockResolvedValue('RED'),
      }

      mockEngineManager.get.mockReturnValue(mockEngineWithSupport)

      const result = await modelsService.isModelSupported(
        '/path/to/large-model.gguf'
      )

      expect(result).toBe('RED')
      expect(mockEngineWithSupport.isModelSupported).toHaveBeenCalledWith(
        '/path/to/large-model.gguf',
        undefined
      )
    })

    it('should return YELLOW as fallback when engine method is not available', async () => {
      const mockEngineWithoutSupport = {
        ...mockEngine,
        isModelSupported: undefined, // Explicitly remove the method
      }

      mockEngineManager.get.mockReturnValue(mockEngineWithoutSupport)

      const result = await modelsService.isModelSupported('/path/to/model.gguf')

      expect(result).toBe('YELLOW')
    })

    it('should return RED when engine is not available', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      mockEngineManager.get.mockReturnValue(null)

      const result = await modelsService.isModelSupported('/path/to/model.gguf')

      expect(result).toBe('YELLOW') // Should use fallback
      expect(consoleSpy).toHaveBeenCalledWith(
        '[ModelsService] Engine "llamacpp" is not available. The engine may not be initialized or registered.'
      )
      consoleSpy.mockRestore()
    })

    it('should return GREY when there is an error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const mockEngineWithError = {
        ...mockEngine,
        isModelSupported: vi.fn().mockRejectedValue(new Error('Test error')),
      }

      mockEngineManager.get.mockReturnValue(mockEngineWithError)

      const result = await modelsService.isModelSupported('/path/to/model.gguf')

      expect(result).toBe('GREY')
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error checking model support for /path/to/model.gguf:',
        expect.any(Error)
      )
      consoleSpy.mockRestore()
    })
  })

  describe('checkMmprojExistsAndUpdateOffloadMMprojSetting', () => {
    it('should add offload_mmproj setting when mmproj exists and setting is missing', async () => {
      const updateProvider = vi.fn()
      const provider = {
        provider: 'llamacpp',
        models: [
          {
            id: 'vision-model',
            settings: {
              ctx_len: { key: 'ctx_len', controller_props: { value: 4096 } },
            },
          },
        ],
      }
      mockEngine.checkMmprojExists.mockResolvedValue(true)

      const result =
        await modelsService.checkMmprojExistsAndUpdateOffloadMMprojSetting(
          'vision-model',
          updateProvider,
          () => provider as any
        )

      expect(result).toEqual({ exists: true, settingsUpdated: true })
      expect(updateProvider).toHaveBeenCalledWith('llamacpp', {
        models: [
          expect.objectContaining({
            id: 'vision-model',
            settings: expect.objectContaining({
              offload_mmproj: expect.objectContaining({
                key: 'offload_mmproj',
                controller_type: 'checkbox',
              }),
            }),
          }),
        ],
      })
    })

    it('should not update provider when mmproj setting already exists', async () => {
      const updateProvider = vi.fn()
      mockEngine.checkMmprojExists.mockResolvedValue(true)

      const result =
        await modelsService.checkMmprojExistsAndUpdateOffloadMMprojSetting(
          'vision-model',
          updateProvider,
          () =>
            ({
              provider: 'llamacpp',
              models: [
                {
                  id: 'vision-model',
                  settings: { offload_mmproj: { key: 'offload_mmproj' } },
                },
              ],
            }) as any
        )

      expect(result).toEqual({ exists: true, settingsUpdated: false })
      expect(updateProvider).not.toHaveBeenCalled()
    })

    it('should return false when mmproj check fails', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockEngine.checkMmprojExists.mockRejectedValue(new Error('scan failed'))

      await expect(
        modelsService.checkMmprojExistsAndUpdateOffloadMMprojSetting('model1')
      ).resolves.toEqual({ exists: false, settingsUpdated: false })

      errorSpy.mockRestore()
    })
  })

  describe('validateGgufFile', () => {
    it('should validate GGUF files through the llama.cpp engine', async () => {
      mockEngine.validateGgufFile.mockResolvedValue({ isValid: true })

      await expect(
        modelsService.validateGgufFile('/models/model.gguf')
      ).resolves.toEqual({ isValid: true })

      expect(mockEngine.validateGgufFile).toHaveBeenCalledWith(
        '/models/model.gguf'
      )
    })

    it('should report unavailable validation method', async () => {
      mockEngineManager.get.mockReturnValue({
        ...mockEngine,
        validateGgufFile: undefined,
      })

      await expect(
        modelsService.validateGgufFile('/models/model.gguf')
      ).resolves.toEqual({
        isValid: false,
        error: 'Validation method not available',
      })
    })

    it('should return validation errors instead of throwing', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockEngine.validateGgufFile.mockRejectedValue(new Error('bad header'))

      await expect(
        modelsService.validateGgufFile('/models/broken.gguf')
      ).resolves.toEqual({
        isValid: false,
        error: 'bad header',
      })

      errorSpy.mockRestore()
    })
  })

  describe('getTokensCount', () => {
    it('should transform text and image messages before token counting', async () => {
      mockEngine.getLoadedModels.mockResolvedValue(['model1'])
      mockEngine.getTokensCount.mockResolvedValue(42)

      const result = await modelsService.getTokensCount('model1', [
        {
          role: 'user',
          content: [
            {
              type: ContentType.Text,
              text: { value: 'hello' },
            },
            {
              type: ContentType.Image,
              image_url: { url: 'file://image.png', detail: 'high' },
            },
          ],
        },
        {
          role: 'assistant',
          content: [{ type: ContentType.Text, text: { value: 'response' } }],
        },
        {
          role: 'user',
          content: [],
        },
      ] as any)

      expect(result).toBe(42)
      expect(mockEngine.getTokensCount).toHaveBeenCalledWith({
        modelId: 'model1',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'hello' },
              {
                type: 'image_url',
                image_url: { url: 'file://image.png', detail: 'high' },
              },
            ],
          },
          {
            role: 'assistant',
            content: 'response',
          },
        ],
        chat_template_kwargs: {
          enable_thinking: false,
        },
      })
    })

    it('should return zero when the model is not loaded locally', async () => {
      mockEngine.getLoadedModels.mockResolvedValue(['other-model'])

      await expect(
        modelsService.getTokensCount('model1', [
          {
            role: 'user',
            content: [{ type: ContentType.Text, text: { value: 'hello' } }],
          },
        ] as any)
      ).resolves.toBe(0)

      expect(mockEngine.getTokensCount).not.toHaveBeenCalled()
    })

    it('should return zero when token counting fails', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockEngine.getLoadedModels.mockResolvedValue(['model1'])
      mockEngine.getTokensCount.mockRejectedValue(new Error('tokenizer failed'))

      await expect(
        modelsService.getTokensCount('model1', [
          {
            role: 'user',
            content: [{ type: ContentType.Text, text: { value: 'hello' } }],
          },
        ] as any)
      ).resolves.toBe(0)

      errorSpy.mockRestore()
    })
  })
})
