/**
 * Default Models Service - Web implementation
 */

import { sanitizeModelId } from '@/lib/utils'
import {
  AIEngine,
  EngineManager,
  SessionInfo,
  SettingComponentProps,
  modelInfo,
  ThreadMessage,
  ContentType,
  events,
  DownloadEvent,
  UnloadResult,
} from '@ax-studio/core'
import { Model as CoreModel } from '@ax-studio/core'
import type {
  ModelsService,
  ModelCatalog,
  HuggingFaceRepo,
  CatalogModel,
  ModelValidationResult,
} from './types'
import { getBundledModelCatalog } from './catalog'
import { huggingFaceRepoSchema } from '@/schemas/models.schema'

// Default provider for local inference
const defaultProvider = 'llamacpp'

export class DefaultModelsService implements ModelsService {
  private getEngine(provider: string = defaultProvider) {
    const engine = EngineManager.instance().get(provider) as AIEngine | undefined
    if (!engine) {
      console.warn(
        `[ModelsService] Engine "${provider}" is not available. The engine may not be initialized or registered.`
      )
    }
    return engine
  }

  private async syncLoadedModelRoute(
    engine: AIEngine,
    model: string
  ): Promise<void> {
    await engine.syncModelRoute(model)
  }

  async getModel(modelId: string): Promise<modelInfo | undefined> {
    return this.getEngine()?.get(modelId)
  }

  async fetchModels(): Promise<modelInfo[]> {
    const engine = this.getEngine()
    if (!engine) {
      throw new Error(
        `[ModelsService] Cannot fetch models: engine "${defaultProvider}" is not available. The engine may not be initialized or registered.`
      )
    }
    return engine.list()
  }

  async fetchModelCatalog(): Promise<ModelCatalog> {
    return getBundledModelCatalog()
  }

  async fetchHuggingFaceRepo(
    repoId: string,
    hfToken?: string,
    signal?: AbortSignal
  ): Promise<HuggingFaceRepo | null> {
    try {
      // Clean the repo ID to handle various input formats
      const cleanRepoId = repoId
        .replace(/^https?:\/\/huggingface\.co\//, '')
        .replace(/^huggingface\.co\//, '')
        .replace(/\/$/, '') // Remove trailing slash
        .trim()

      if (!cleanRepoId || !cleanRepoId.includes('/')) {
        return null
      }

      const response = await fetch(
        `https://huggingface.co/api/models/${cleanRepoId}?blobs=true&files_metadata=true`,
        {
          signal,
          headers: hfToken
            ? {
                Authorization: `Bearer ${hfToken}`,
              }
            : {},
        }
      )

      if (!response.ok) {
        if (response.status === 404) {
          return null // Repository not found
        }
        throw new Error(
          `Failed to fetch HuggingFace repository: ${response.status} ${response.statusText}`
        )
      }

      const repoData = await response.json()
      const parsed = huggingFaceRepoSchema.safeParse(repoData)
      if (!parsed.success) {
        console.warn('HuggingFace API response did not match expected schema:', parsed.error.message)
        return null
      }
      return parsed.data
    } catch (error) {
      // Propagate abort errors so callers can distinguish cancellation from failure
      if (error instanceof Error && error.name === 'AbortError') throw error
      console.error('Error fetching HuggingFace repository:', error)
      return null
    }
  }

  convertHfRepoToCatalogModel(repo: HuggingFaceRepo): CatalogModel {
    // Format file size helper
    const formatFileSize = (size?: number) => {
      if (!size) return 'Unknown size'
      if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`
      return `${(size / 1024 ** 3).toFixed(1)} GB`
    }

    // Extract GGUF files from the repository siblings
    const ggufFiles =
      repo.siblings?.filter((file) =>
        file.rfilename.toLowerCase().endsWith('.gguf')
      ) || []

    // Separate regular GGUF files from mmproj files
    const regularGgufFiles = ggufFiles.filter(
      (file) => !file.rfilename.toLowerCase().includes('mmproj')
    )

    const mmprojFiles = ggufFiles.filter((file) =>
      file.rfilename.toLowerCase().includes('mmproj')
    )

    // Convert regular GGUF files to quants format
    const quants = regularGgufFiles.map((file) => {
      // Generate model_id from filename (remove .gguf extension, case-insensitive)
      const modelId = file.rfilename.replace(/\.gguf$/i, '')

      return {
        model_id: `${repo.author}/${sanitizeModelId(modelId)}`,
        path: `https://huggingface.co/${repo.modelId}/resolve/main/${file.rfilename}`,
        file_size: formatFileSize(file.size),
      }
    })

    // Convert mmproj files to mmproj_models format
    const mmprojModels = mmprojFiles.map((file) => {
      const modelId = file.rfilename.replace(/\.gguf$/i, '')

      return {
        model_id: sanitizeModelId(modelId),
        path: `https://huggingface.co/${repo.modelId}/resolve/main/${file.rfilename}`,
        file_size: formatFileSize(file.size),
      }
    })

    // Extract safetensors files
    const safetensorsFiles =
      repo.siblings?.filter((file) =>
        file.rfilename.toLowerCase().endsWith('.safetensors')
      ) || []

    // Check if this repository has MLX model files (safetensors + associated files)
    const hasMlxFiles =
      repo.library_name === 'mlx' || repo.tags?.includes('mlx')

    const safetensorsModels = safetensorsFiles.map((file) => {
      // Generate model_id from filename (remove .safetensors extension, case-insensitive)
      const modelId = file.rfilename.replace(/\.safetensors$/i, '')

      return {
        model_id: sanitizeModelId(modelId),
        path: `https://huggingface.co/${repo.modelId}/resolve/main/${file.rfilename}`,
        file_size: formatFileSize(file.size),
        sha256: file.lfs?.sha256,
      }
    })

    return {
      model_name: repo.modelId,
      developer: repo.author,
      downloads: repo.downloads || 0,
      created_at: repo.createdAt,
      num_quants: quants.length,
      quants: quants,
      num_mmproj: mmprojModels.length,
      mmproj_models: mmprojModels,
      safetensors_files: safetensorsModels,
      num_safetensors: safetensorsModels.length,
      is_mlx: hasMlxFiles,
      readme: `https://huggingface.co/${repo.modelId}/resolve/main/README.md`,
      description: `**Tags**: ${repo.tags?.join(', ')}`,
    }
  }

  async updateModel(modelId: string, model: Partial<CoreModel>): Promise<void> {
    if (model.settings) {
      this.getEngine()?.updateSettings(
        model.settings as SettingComponentProps[]
      )
    }
    // Note: Model name/ID updates are handled at the provider level in the frontend
    console.log('Model update request processed for modelId:', modelId)
  }

  async pullModel(
    id: string,
    modelPath: string,
    modelSha256?: string,
    modelSize?: number,
    mmprojPath?: string,
    mmprojSha256?: string,
    mmprojSize?: number,
    downloadHeaders?: Record<string, string>
  ): Promise<void> {
    const engine = this.getEngine()
    if (!engine) {
      throw new Error(
        `Engine "${defaultProvider}" is not available. Cannot pull model "${id}".`
      )
    }
    return engine.import(id, {
      modelPath,
      mmprojPath,
      modelSha256,
      modelSize,
      mmprojSha256,
      mmprojSize,
      downloadHeaders,
    })
  }

  async pullModelWithMetadata(
    id: string,
    modelPath: string,
    mmprojPath?: string,
    hfToken?: string,
    skipVerification: boolean = false
  ): Promise<void> {
    let modelSha256: string | undefined
    let modelSize: number | undefined
    let mmprojSha256: string | undefined
    let mmprojSize: number | undefined

    // Extract repo ID from model URL
    // URL format: https://huggingface.co/{repo}/resolve/main/{filename}
    const modelUrlMatch = modelPath.match(
      /https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/main\/(.+)/
    )

    if (modelUrlMatch && !skipVerification) {
      const [, repoId, modelFilename] = modelUrlMatch

      try {
        // Fetch real-time metadata from HuggingFace
        const repoInfo = await this.fetchHuggingFaceRepo(repoId, hfToken)

        if (repoInfo?.siblings) {
          // Find the specific model file
          const modelFile = repoInfo.siblings.find(
            (file) => file.rfilename === modelFilename
          )
          if (modelFile?.lfs) {
            modelSha256 = modelFile.lfs.sha256
            modelSize = modelFile.lfs.size
          }

          // If mmproj path provided, extract its metadata too
          if (mmprojPath) {
            const mmprojUrlMatch = mmprojPath.match(
              /https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/main\/(.+)/
            )
            if (mmprojUrlMatch) {
              const [, mmprojFilename] = mmprojUrlMatch
              const mmprojFile = repoInfo.siblings.find(
                (file) => file.rfilename === mmprojFilename
              )
              if (mmprojFile?.lfs) {
                mmprojSha256 = mmprojFile.lfs.sha256
                mmprojSize = mmprojFile.lfs.size
              }
            }
          }
        }
      } catch (error) {
        console.warn(
          'Failed to fetch HuggingFace metadata, proceeding without hash verification:',
          error
        )
      }
    }

    // Call the original pullModel with the fetched metadata
    return this.pullModel(
      id,
      modelPath,
      modelSha256,
      modelSize,
      mmprojPath,
      mmprojSha256,
      mmprojSize,
      hfToken ? { Authorization: `Bearer ${hfToken}` } : undefined
    )
  }

  async abortDownload(id: string): Promise<void> {
    const llamacppEngine = this.getEngine('llamacpp')
    const mlxEngine = this.getEngine('mlx')
    try {
      await Promise.allSettled([
        llamacppEngine?.abortImport(id),
        mlxEngine?.abortImport(id),
      ].filter(Boolean))
    } finally {
      events.emit(DownloadEvent.onFileDownloadStopped, {
        modelId: id,
        downloadType: 'Model',
      })
    }
  }

  async deleteModel(id: string, provider?: string): Promise<void> {
    const engine = this.getEngine(provider)
    if (!engine) {
      throw new Error(
        `[ModelsService] Cannot delete model: engine "${provider ?? defaultProvider}" is not available.`
      )
    }
    return engine.delete(id)
  }

  async getActiveModels(provider?: string): Promise<string[]> {
    const engine = this.getEngine(provider)
    if (!engine) return []
    return engine.getLoadedModels() ?? []
  }

  async stopModel(
    model: string,
    provider?: string
  ): Promise<UnloadResult | undefined> {
    return this.getEngine(provider)?.unload(model)
  }

  async stopAllModels(): Promise<void> {
    // Fetch active model lists from both engines in parallel, then stop
    // every model with `allSettled` so a single failing unload doesn't
    // skip the rest. Previously, if one llamacpp unload failed, the
    // subsequent `await Promise.all(...)` rejected and the mlx loop below
    // never ran — leaving mlx models loaded on logout / factory reset.
    const [llamaCppModels, mlxModels] = await Promise.all([
      this.getActiveModels('llamacpp').catch(() => [] as string[]),
      this.getActiveModels('mlx').catch(() => [] as string[]),
    ])
    const results = await Promise.allSettled([
      ...(llamaCppModels ?? []).map((model) =>
        this.stopModel(model, 'llamacpp')
      ),
      ...(mlxModels ?? []).map((model) => this.stopModel(model, 'mlx')),
    ])
    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn(
          '[ModelsService] stopAllModels unload failed:',
          result.reason
        )
      }
    }
  }

  async startModel(
    provider: ProviderObject,
    model: string,
    bypassAutoUnload: boolean = false
  ): Promise<SessionInfo | undefined> {
    const engine = this.getEngine(provider.provider)
    if (!engine) return undefined

    const loadedModels = (await engine.getLoadedModels()) ?? []
    if (loadedModels.includes(model)) {
      await this.syncLoadedModelRoute(engine, model)
      return undefined
    }

    // Find the model configuration to get settings
    const modelConfig = provider.models.find((m) => m.id === model)

    // Key mapping function to transform setting keys
    const mapSettingKey = (key: string): string => {
      const keyMappings: Record<string, string> = {
        ctx_len: 'ctx_size',
        ngl: 'n_gpu_layers',
      }
      return keyMappings[key] || key
    }

    // Only keys in this set are load-time llama.cpp overrides. Everything
    // else (temperature, top_p, top_k, frequency_penalty, …) is a per-request
    // sampling parameter and must NOT be forwarded to engine.load() — the
    // llamacpp extension used to hard-fail with "Unsupported load override
    // setting: <name>" when mixed settings leaked through.
    const LOAD_TIME_SETTING_KEYS = new Set<string>([
      'fit', 'fit_target', 'fit_ctx',
      'chat_template', 'n_gpu_layers', 'offload_mmproj',
      'cpu_moe', 'n_cpu_moe', 'override_tensor_buffer_t',
      'ctx_size', 'threads', 'threads_batch',
      'n_predict', 'batch_size', 'ubatch_size',
      'device', 'split_mode', 'main_gpu',
      'flash_attn', 'cont_batching',
      // common aliases that mapSettingKey normalizes to allowed keys
      'ctx_len', 'ngl',
    ])

    const settings = modelConfig?.settings
      ? Object.fromEntries(
          Object.entries(modelConfig.settings)
            .filter(([key]) => LOAD_TIME_SETTING_KEYS.has(key))
            .map(([key, value]) => [
              mapSettingKey(key),
              value.controller_props?.value,
            ])
        )
      : undefined

    return engine
      .load(model, settings, false, bypassAutoUnload)
      .catch((error) => {
        console.error(
          `Failed to start model ${model} for provider ${provider.provider}:`,
          error
        )
        throw error
      })
  }

  async isToolSupported(modelId: string): Promise<boolean> {
    const engine = this.getEngine()
    if (!engine) return false

    return engine.isToolSupported(modelId)
  }

  async checkMmprojExistsAndUpdateOffloadMMprojSetting(
    modelId: string,
    updateProvider?: (
      providerName: string,
      data: Partial<ModelProvider>
    ) => void,
    getProviderByName?: (providerName: string) => ModelProvider | undefined
  ): Promise<{ exists: boolean; settingsUpdated: boolean }> {
    let settingsUpdated = false

    try {
      const engine = this.getEngine('llamacpp') as AIEngine & {
        checkMmprojExists?: (id: string) => Promise<boolean>
      }
      if (engine && typeof engine.checkMmprojExists === 'function') {
        const exists = await engine.checkMmprojExists(modelId)

        if (updateProvider && getProviderByName) {
          const provider = getProviderByName('llamacpp')
          if (provider) {
            const model = provider.models.find((m) => m.id === modelId)

            if (model?.settings) {
              const hasOffloadMmproj = 'offload_mmproj' in model.settings

              if (exists && !hasOffloadMmproj) {
                const updatedModels = provider.models.map((m) => {
                  if (m.id === modelId) {
                    return {
                      ...m,
                      settings: {
                        ...m.settings,
                        offload_mmproj: {
                          key: 'offload_mmproj',
                          title: 'Offload MMProj',
                          description:
                            'Offload multimodal projection model to GPU',
                          controller_type: 'checkbox',
                          controller_props: {
                            value: true,
                          },
                        },
                      },
                    }
                  }
                  return m
                })

                updateProvider('llamacpp', { models: updatedModels })
                settingsUpdated = true
              }
            }
          }
        }
        return { exists, settingsUpdated }
      }
    } catch (error) {
      console.error(`Error checking mmproj for model ${modelId}:`, error)
    }
    return { exists: false, settingsUpdated }
  }

  async checkMmprojExists(modelId: string): Promise<boolean> {
    try {
      const engine = this.getEngine('llamacpp') as AIEngine & {
        checkMmprojExists?: (id: string) => Promise<boolean>
      }
      if (engine && typeof engine.checkMmprojExists === 'function') {
        return await engine.checkMmprojExists(modelId)
      }
    } catch (error) {
      console.error(`Error checking mmproj for model ${modelId}:`, error)
    }
    return false
  }

  async isModelSupported(
    modelPath: string,
    ctxSize?: number
  ): Promise<'RED' | 'YELLOW' | 'GREEN' | 'GREY'> {
    try {
      const engine = this.getEngine('llamacpp') as AIEngine & {
        isModelSupported?: (
          path: string,
          ctx_size?: number
        ) => Promise<'RED' | 'YELLOW' | 'GREEN'>
      }
      if (engine && typeof engine.isModelSupported === 'function') {
        return await engine.isModelSupported(modelPath, ctxSize)
      }
      return 'YELLOW'
    } catch (error) {
      console.error(`Error checking model support for ${modelPath}:`, error)
      return 'GREY'
    }
  }

  async validateGgufFile(filePath: string): Promise<ModelValidationResult> {
    try {
      const engine = this.getEngine('llamacpp') as AIEngine & {
        validateGgufFile?: (path: string) => Promise<ModelValidationResult>
      }

      if (engine && typeof engine.validateGgufFile === 'function') {
        return await engine.validateGgufFile(filePath)
      }

      return {
        isValid: false,
        error: 'Validation method not available',
      }
    } catch (error) {
      console.error(`Error validating GGUF file ${filePath}:`, error)
      return {
        isValid: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async getTokensCount(
    modelId: string,
    messages: ThreadMessage[]
  ): Promise<number> {
    try {
      const engine = this.getEngine('llamacpp') as AIEngine & {
        getTokensCount?: (opts: {
          modelId: string
          messages: Array<{
            role: string
            content:
              | string
              | Array<{
                  type: string
                  text?: string
                  image_url?: {
                    detail?: string
                    url?: string
                  }
                }>
          }>
          chat_template_kwargs?: {
            enable_thinking: boolean
          }
        }) => Promise<number>
        getLoadedModels?: () => Promise<string[]>
      }

      if (engine && typeof engine.getTokensCount === 'function') {
        // Only count tokens for models loaded in llamacpp — cloud/remote
        // models don't have local sessions and would throw.
        const loadedModels = await engine.getLoadedModels?.() ?? []
        if (!loadedModels.includes(modelId)) return 0
        const transformedMessages = messages
          .map((message) => {
            let content:
              | string
              | Array<{
                  type: string
                  text?: string
                  image_url?: {
                    detail?: string
                    url?: string
                  }
                }> = ''

            if (message.content && message.content.length > 0) {
              const hasImages = message.content.some(
                (content) => content.type === ContentType.Image
              )

              if (hasImages) {
                content = message.content.map((contentItem) => {
                  if (contentItem.type === ContentType.Text) {
                    return {
                      type: 'text',
                      text: contentItem.text?.value || '',
                    }
                  } else if (contentItem.type === ContentType.Image) {
                    return {
                      type: 'image_url',
                      image_url: {
                        detail: contentItem.image_url?.detail,
                        url: contentItem.image_url?.url || '',
                      },
                    }
                  }
                  return {
                    type: contentItem.type,
                    text: contentItem.text?.value,
                    image_url: contentItem.image_url,
                  }
                })
              } else {
                const textContents = message.content
                  .filter(
                    (content) =>
                      content.type === ContentType.Text && content.text?.value
                  )
                  .map((content) => content.text?.value || '')

                content = textContents.join(' ')
              }
            }

            return {
              role: message.role,
              content,
            }
          })
          .filter((msg) =>
            typeof msg.content === 'string'
              ? msg.content.trim() !== ''
              : Array.isArray(msg.content) && msg.content.length > 0
          )

        return await engine.getTokensCount({
          modelId,
          messages: transformedMessages,
          chat_template_kwargs: {
            enable_thinking: false,
          },
        })
      }
      return 0
    } catch (error) {
      console.error(`Error getting tokens count for model ${modelId}:`, error)
      return 0
    }
  }
}
