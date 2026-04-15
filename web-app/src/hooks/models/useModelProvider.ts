import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { ANTHROPIC_DEFAULT_HEADERS } from '@/constants/providers'
import { mergeProviders } from '@/lib/providers/model-provider-merge'
import { createSafeJSONStorage } from '@/lib/storage'

function syncSelectedModel(
  providers: ModelProvider[],
  selectedProvider: string,
  selectedModel: Model | null
): Pick<ModelProviderState, 'selectedProvider' | 'selectedModel'> {
  if (!selectedProvider) {
    return {
      selectedProvider: '',
      selectedModel: null,
    }
  }

  const provider = providers.find(
    (item) => item.provider === selectedProvider
  )

  if (!provider) {
    return {
      selectedProvider: '',
      selectedModel: null,
    }
  }

  if (!selectedModel?.id) {
    return {
      selectedProvider,
      selectedModel: null,
    }
  }

  return {
    selectedProvider,
    selectedModel:
      provider.models.find((model) => model.id === selectedModel.id) ?? null,
  }
}

type ModelProviderState = {
  providers: ModelProvider[]
  selectedProvider: string
  selectedModel: Model | null
  deletedModels: string[]
  getModelBy: (modelId: string) => Model | undefined
  setProviders: (providers: ModelProvider[], pathSep?: string) => void
  getProviderByName: (providerName: string) => ModelProvider | undefined
  updateProvider: (providerName: string, data: Partial<ModelProvider>) => void
  selectModelProvider: (
    providerName: string,
    modelName: string
  ) => Model | undefined
  addProvider: (provider: ModelProvider) => void
  deleteProvider: (providerName: string) => void
  deleteModel: (modelId: string) => void
}

export const useModelProvider = create<ModelProviderState>()(
  persist(
    (set, get) => ({
      providers: [],
      selectedProvider: '',
      selectedModel: null,
      deletedModels: [],
      getModelBy: (modelId: string) => {
        const provider = get().providers.find(
          (provider) => provider.provider === get().selectedProvider
        )
        if (!provider) return undefined
        return provider.models.find((model) => model.id === modelId)
      },
      setProviders: (providers, pathSep = '/') =>
        set((state) => {
          const mergedProviders = mergeProviders(
            providers,
            state.providers,
            state.deletedModels,
            pathSep
          )

          return {
            providers: mergedProviders,
            ...syncSelectedModel(
              mergedProviders,
              state.selectedProvider,
              state.selectedModel
            ),
          }
        }),
      updateProvider: (providerName, data) => {
        set((state) => {
          const providers = state.providers.map((provider) => {
            if (provider.provider === providerName) {
              return {
                ...provider,
                ...data,
              }
            }
            return provider
          })

          return {
            providers,
            ...syncSelectedModel(
              providers,
              state.selectedProvider,
              state.selectedModel
            ),
          }
        })
      },
      getProviderByName: (providerName: string) => {
        const provider = get().providers.find(
          (provider) => provider.provider === providerName
        )

        return provider
      },
      selectModelProvider: (providerName: string, modelName: string) => {
        // Find the model object
        const provider = get().providers.find(
          (provider) => provider.provider === providerName
        )

        let modelObject: Model | undefined = undefined

        if (provider && provider.models) {
          modelObject = provider.models.find((model) => model.id === modelName)
        }

        // Update state with provider name and model object
        set({
          selectedProvider: providerName,
          selectedModel: modelObject || null,
        })

        return modelObject
      },
      deleteModel: (modelId: string) => {
        set((state) => {
          // Ensure deletedModels is always an array
          const currentDeletedModels = Array.isArray(state.deletedModels)
            ? state.deletedModels
            : []

          const providers = state.providers.map((provider) => {
            const models = provider.models.filter(
              (model) => model.id !== modelId
            )
            return {
              ...provider,
              models,
            }
          })

          return {
            providers,
            deletedModels: [...currentDeletedModels, modelId],
            ...syncSelectedModel(
              providers,
              state.selectedProvider,
              state.selectedModel
            ),
          }
        })
      },
      addProvider: (provider: ModelProvider) => {
        set((state) => ({
          providers: [...state.providers, provider],
        }))
      },
      deleteProvider: (providerName: string) => {
        set((state) => {
          const providers = state.providers.filter(
            (provider) => provider.provider !== providerName
          )

          return {
            providers,
            ...syncSelectedModel(
              providers,
              state.selectedProvider,
              state.selectedModel
            ),
          }
        })
      },
    }),
    {
      name: localStorageKey.modelProvider,
      storage: createSafeJSONStorage(() => localStorage, 'useModelProvider'),
      partialize: (state) => ({
        providers: state.providers.map((provider) => ({
          ...provider,
          models: provider.models.map((model) => ({
            id: model.id,
            model: model.model,
            name: model.name,
            capabilities: model.capabilities,
            embedding: model.embedding,
            provider: model.provider,
            settings: model.settings,
          })),
        })),
        selectedProvider: state.selectedProvider,
        selectedModel: state.selectedModel
          ? {
              id: state.selectedModel.id,
              model: state.selectedModel.model,
              name: state.selectedModel.name,
              capabilities: state.selectedModel.capabilities,
              embedding: state.selectedModel.embedding,
              provider: state.selectedModel.provider,
              settings: state.selectedModel.settings,
            }
          : null,
        deletedModels: state.deletedModels,
      }),
      migrate: (persistedState: unknown, version: number) => {
        // Deep-clone the persisted state before mutating it. The previous
        // implementation mutated the input object in place, which can
        // break Zustand devtools, re-hydration retries, and any storage
        // adapters that hand back cached references.
        const state = JSON.parse(
          JSON.stringify(persistedState)
        ) as ModelProviderState & {
          providers: Array<
            ModelProvider & {
              models: Array<
                Model & {
                  settings?: Record<string, unknown> & {
                    chatTemplate?: string
                    chat_template?: string
                  }
                }
              >
            }
          >
        }

        if (version <= 3 && state?.providers) {
          state.providers.forEach((provider) => {
            // Migrate Anthropic provider base URL and add custom headers
            if (provider.provider === 'anthropic') {
              if (provider.base_url === 'https://api.anthropic.com') {
                provider.base_url = 'https://api.anthropic.com/v1'
              }

              // Update base-url in settings
              if (provider.settings) {
                const baseUrlSetting = provider.settings.find(
                  (s) => s.key === 'base-url'
                )
                if (
                  baseUrlSetting?.controller_props?.value ===
                  'https://api.anthropic.com'
                ) {
                  baseUrlSetting.controller_props.value =
                    'https://api.anthropic.com/v1'
                }
                if (
                  baseUrlSetting?.controller_props?.placeholder ===
                  'https://api.anthropic.com'
                ) {
                  baseUrlSetting.controller_props.placeholder =
                    'https://api.anthropic.com/v1'
                }
              }

              if (!provider.custom_header) {
                provider.custom_header = [...ANTHROPIC_DEFAULT_HEADERS]
              }
            }

            if (provider.provider === 'cohere') {
              if (
                provider.base_url === 'https://api.cohere.ai/compatibility/v1'
              ) {
                provider.base_url = 'https://api.cohere.ai/v1'
              }

              // Update base-url in settings
              if (provider.settings) {
                const baseUrlSetting = provider.settings.find(
                  (s) => s.key === 'base-url'
                )
                if (
                  baseUrlSetting?.controller_props?.value ===
                  'https://api.cohere.ai/compatibility/v1'
                ) {
                  baseUrlSetting.controller_props.value =
                    'https://api.cohere.ai/v1'
                }
                if (
                  baseUrlSetting?.controller_props?.placeholder ===
                  'https://api.cohere.ai/compatibility/v1'
                ) {
                  baseUrlSetting.controller_props.placeholder =
                    'https://api.cohere.ai/v1'
                }
              }
            }
          })
        }

        if (version <= 7 && state?.providers) {
          // Remove 'proactive' capability from all models as it's now managed in MCP settings
          state.providers.forEach((provider) => {
            if (provider.models) {
              provider.models.forEach((model) => {
                if (model.capabilities) {
                  model.capabilities = model.capabilities.filter(
                    (cap) => cap !== 'proactive'
                  )
                }
              })
            }
          })
        }

        if (version <= 9 && state?.providers) {
          state.providers = state.providers.filter(
            (provider) => provider.provider !== 'cohere'
          )
        }
        return state
      },
      version: 10,
    }
  )
)
