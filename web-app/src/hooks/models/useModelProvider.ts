import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { ANTHROPIC_DEFAULT_HEADERS } from '@/constants/providers'
import { mergeProviders } from '@/lib/providers/model-provider-merge'
import { createSafeJSONStorage } from '@/lib/storage/storage'

const MAX_PERSISTED_PROVIDERS = 100
const MAX_PERSISTED_MODELS_PER_PROVIDER = 2000
const MAX_DELETED_MODELS = 2000
const MAX_PROVIDER_SETTINGS = 100
const MAX_PROVIDER_HEADERS = 50
const MAX_MODEL_CAPABILITIES = 100

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

  const provider = providers.find((item) => item.provider === selectedProvider)

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

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const normalizeNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

const normalizeOptionalString = (value: unknown): string | undefined => {
  return typeof value === 'string' ? value : undefined
}

const normalizeStringList = (value: unknown, maxItems: number): string[] => {
  if (!Array.isArray(value)) return []

  const values: string[] = []
  for (const item of value) {
    const normalized = normalizeNonEmptyString(item)
    if (!normalized || values.includes(normalized)) continue

    values.push(normalized)
    if (values.length >= maxItems) break
  }

  return values
}

const normalizeControllerProps = (value: unknown): ControllerProps => {
  if (!isPlainRecord(value)) return {}

  const props: ControllerProps = {}
  if (
    typeof value.value === 'string' ||
    typeof value.value === 'boolean' ||
    typeof value.value === 'number'
  ) {
    props.value = value.value
  }
  if (typeof value.placeholder === 'string') {
    props.placeholder = value.placeholder
  }
  if (typeof value.type === 'string') {
    props.type = value.type
  }
  if (Array.isArray(value.options)) {
    props.options = value.options
      .filter(
        (option): option is { value: number | string; name: string } =>
          isPlainRecord(option) &&
          (typeof option.value === 'string' ||
            typeof option.value === 'number') &&
          typeof option.name === 'string'
      )
      .slice(0, MAX_PROVIDER_SETTINGS)
  }
  const inputActions = normalizeStringList(
    value.input_actions,
    MAX_PROVIDER_SETTINGS
  )
  if (inputActions.length > 0) {
    props.input_actions = inputActions
  }
  if (typeof value.recommended === 'string') {
    props.recommended = value.recommended
  }

  return props
}

const normalizeProviderSetting = (value: unknown): ProviderSetting | null => {
  if (!isPlainRecord(value)) return null

  const key = normalizeNonEmptyString(value.key)
  if (!key) return null

  return {
    key,
    title: normalizeOptionalString(value.title) ?? key,
    description: normalizeOptionalString(value.description) ?? '',
    controller_type: normalizeOptionalString(value.controller_type) ?? 'input',
    controller_props: normalizeControllerProps(value.controller_props),
  }
}

const normalizeProviderSettings = (value: unknown): ProviderSetting[] => {
  if (!Array.isArray(value)) return []

  const settings: ProviderSetting[] = []
  for (const item of value) {
    const setting = normalizeProviderSetting(item)
    if (!setting || settings.some((existing) => existing.key === setting.key)) {
      continue
    }

    settings.push(setting)
    if (settings.length >= MAX_PROVIDER_SETTINGS) break
  }

  return settings
}

const normalizeModelSettings = (
  value: unknown
): Record<string, ProviderSetting> | undefined => {
  if (!isPlainRecord(value)) return undefined

  const settings: Record<string, ProviderSetting> = {}
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = normalizeNonEmptyString(key)
    const setting = normalizeProviderSetting(item)
    if (!normalizedKey || !setting) continue

    settings[normalizedKey] = setting
    if (Object.keys(settings).length >= MAX_PROVIDER_SETTINGS) break
  }

  return Object.keys(settings).length > 0 ? settings : undefined
}

const normalizeModel = (value: unknown): Model | null => {
  if (!isPlainRecord(value)) return null

  const id =
    normalizeNonEmptyString(value.id) ?? normalizeNonEmptyString(value.model)
  if (!id) return null

  const model: Model = { id }
  const modelName = normalizeOptionalString(value.model)
  if (modelName) model.model = modelName

  const provider = normalizeOptionalString(value.provider)
  if (provider) {
    const modelWithProvider = model as Model & { provider?: string }
    modelWithProvider.provider = provider
  }

  const name = normalizeOptionalString(value.name)
  if (name) model.name = name

  const displayName = normalizeOptionalString(value.displayName)
  if (displayName) model.displayName = displayName

  if (typeof value.version === 'string' || typeof value.version === 'number') {
    model.version = value.version
  }

  const description = normalizeOptionalString(value.description)
  if (description) model.description = description

  const format = normalizeOptionalString(value.format)
  if (format) model.format = format

  const capabilities = normalizeStringList(
    value.capabilities,
    MAX_MODEL_CAPABILITIES
  )
  if (capabilities.length > 0) model.capabilities = capabilities

  const settings = normalizeModelSettings(value.settings)
  if (settings) model.settings = settings

  if (typeof value.embedding === 'boolean') {
    model.embedding = value.embedding
  }

  return model
}

const normalizeModels = (value: unknown): Model[] => {
  if (!Array.isArray(value)) return []

  const models: Model[] = []
  for (const item of value) {
    const model = normalizeModel(item)
    if (!model || models.some((existing) => existing.id === model.id)) {
      continue
    }

    models.push(model)
    if (models.length >= MAX_PERSISTED_MODELS_PER_PROVIDER) break
  }

  return models
}

const normalizeProviderHeader = (
  value: unknown
): ProviderCustomHeader | null => {
  if (!isPlainRecord(value)) return null

  const header = normalizeNonEmptyString(value.header)
  const headerValue = normalizeOptionalString(value.value)
  if (!header || headerValue === undefined) return null

  return { header, value: headerValue }
}

const normalizeProviderHeaders = (
  value: unknown
): ProviderCustomHeader[] | null | undefined => {
  if (value === null) return null
  if (!Array.isArray(value)) return undefined

  const headers: ProviderCustomHeader[] = []
  for (const item of value) {
    const header = normalizeProviderHeader(item)
    if (
      !header ||
      headers.some((existing) => existing.header === header.header)
    ) {
      continue
    }

    headers.push(header)
    if (headers.length >= MAX_PROVIDER_HEADERS) break
  }

  return headers
}

const normalizeProvider = (value: unknown): ModelProvider | null => {
  if (!isPlainRecord(value)) return null

  const providerName = normalizeNonEmptyString(value.provider)
  if (!providerName) return null

  const provider: ModelProvider = {
    provider: providerName,
    active: typeof value.active === 'boolean' ? value.active : true,
    settings: normalizeProviderSettings(value.settings),
    models: normalizeModels(value.models),
  }

  const exploreModelsUrl = normalizeOptionalString(value.explore_models_url)
  if (exploreModelsUrl) provider.explore_models_url = exploreModelsUrl

  const apiKey = normalizeOptionalString(value.api_key)
  if (apiKey !== undefined) provider.api_key = apiKey

  const baseUrl = normalizeOptionalString(value.base_url)
  if (baseUrl !== undefined) provider.base_url = baseUrl

  if (typeof value.persist === 'boolean') provider.persist = value.persist

  const customHeader = normalizeProviderHeaders(value.custom_header)
  if (customHeader !== undefined) provider.custom_header = customHeader

  return provider
}

const normalizeProviders = (value: unknown): ModelProvider[] => {
  if (!Array.isArray(value)) return []

  const providers: ModelProvider[] = []
  for (const item of value) {
    const provider = normalizeProvider(item)
    if (
      !provider ||
      providers.some((existing) => existing.provider === provider.provider)
    ) {
      continue
    }

    providers.push(provider)
    if (providers.length >= MAX_PERSISTED_PROVIDERS) break
  }

  return providers
}

const sanitizePersistedModelProvider = (
  persisted: unknown
): Pick<
  ModelProviderState,
  'providers' | 'selectedProvider' | 'selectedModel' | 'deletedModels'
> => {
  if (!isPlainRecord(persisted)) {
    return {
      providers: [],
      selectedProvider: '',
      selectedModel: null,
      deletedModels: [],
    }
  }

  const providers = normalizeProviders(persisted.providers)
  const selectedProvider =
    normalizeNonEmptyString(persisted.selectedProvider) ?? ''
  const selectedModel = normalizeModel(persisted.selectedModel)
  const deletedModels = normalizeStringList(
    persisted.deletedModels,
    MAX_DELETED_MODELS
  )

  return {
    providers,
    deletedModels,
    ...syncSelectedModel(providers, selectedProvider, selectedModel),
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
        const normalizedModelId = normalizeNonEmptyString(modelId)
        if (!normalizedModelId) return undefined

        const provider = get().providers.find(
          (provider) => provider.provider === get().selectedProvider
        )
        if (!provider) return undefined
        return provider.models.find((model) => model.id === normalizedModelId)
      },
      setProviders: (providers, pathSep = '/') =>
        set((state) => {
          if (!Array.isArray(providers)) return state

          const mergedProviders = mergeProviders(
            normalizeProviders(providers),
            normalizeProviders(state.providers),
            normalizeStringList(state.deletedModels, MAX_DELETED_MODELS),
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
        const normalizedProviderName = normalizeNonEmptyString(providerName)
        if (!normalizedProviderName || !isPlainRecord(data)) return

        set((state) => {
          const providers = state.providers.map((provider) => {
            if (provider.provider === normalizedProviderName) {
              return normalizeProvider({
                ...provider,
                ...data,
              }) ?? provider
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
        const normalizedProviderName = normalizeNonEmptyString(providerName)
        if (!normalizedProviderName) return undefined

        const provider = get().providers.find(
          (provider) => provider.provider === normalizedProviderName
        )

        return provider
      },
      selectModelProvider: (providerName: string, modelName: string) => {
        const normalizedProviderName = normalizeNonEmptyString(providerName)
        const normalizedModelName = normalizeNonEmptyString(modelName)
        if (!normalizedProviderName || !normalizedModelName) return undefined

        // Find the model object
        const provider = get().providers.find(
          (provider) => provider.provider === normalizedProviderName
        )

        let modelObject: Model | undefined = undefined

        if (provider && provider.models) {
          modelObject = provider.models.find(
            (model) => model.id === normalizedModelName
          )
        }

        // Update state with provider name and model object
        set({
          selectedProvider: normalizedProviderName,
          selectedModel: modelObject || null,
        })

        return modelObject
      },
      deleteModel: (modelId: string) => {
        const normalizedModelId = normalizeNonEmptyString(modelId)
        if (!normalizedModelId) return

        set((state) => {
          // Ensure deletedModels is always an array
          const currentDeletedModels = normalizeStringList(
            state.deletedModels,
            MAX_DELETED_MODELS
          )

          const providers = state.providers.map((provider) => {
            const models = provider.models.filter(
              (model) => model.id !== normalizedModelId
            )
            return {
              ...provider,
              models,
            }
          })

          return {
            providers,
            deletedModels: normalizeStringList(
              [...currentDeletedModels, normalizedModelId],
              MAX_DELETED_MODELS
            ),
            ...syncSelectedModel(
              providers,
              state.selectedProvider,
              state.selectedModel
            ),
          }
        })
      },
      addProvider: (provider: ModelProvider) => {
        const normalizedProvider = normalizeProvider(provider)
        if (!normalizedProvider) return

        set((state) => ({
          providers: [
            ...state.providers.filter(
              (item) => item.provider !== normalizedProvider.provider
            ),
            normalizedProvider,
          ],
        }))
      },
      deleteProvider: (providerName: string) => {
        const normalizedProviderName = normalizeNonEmptyString(providerName)
        if (!normalizedProviderName) return

        set((state) => {
          const providers = state.providers.filter(
            (provider) => provider.provider !== normalizedProviderName
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
      merge: (persisted, current) => ({
        ...current,
        ...sanitizePersistedModelProvider(persisted),
      }),
      partialize: (state) => ({
        ...sanitizePersistedModelProvider(state),
      }),
      migrate: (persistedState: unknown, version: number) => {
        const state = sanitizePersistedModelProvider(
          persistedState
        ) as ModelProviderState & {
          providers: Array<
            ModelProvider & {
              models: Array<
                Model & {
                  settings?: Record<string, ProviderSetting> & {
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

        if (version <= 8 && state?.providers) {
          state.providers.forEach((provider) => {
            if (provider.provider !== 'mistral') return

            if (provider.base_url === 'https://api.mistral.ai') {
              provider.base_url = 'https://api.mistral.ai/v1'
            }

            const baseUrlSetting = provider.settings?.find(
              (setting) => setting.key === 'base-url'
            )
            if (
              baseUrlSetting?.controller_props?.value ===
              'https://api.mistral.ai'
            ) {
              baseUrlSetting.controller_props.value =
                'https://api.mistral.ai/v1'
            }
            if (
              baseUrlSetting?.controller_props?.placeholder ===
              'https://api.mistral.ai'
            ) {
              baseUrlSetting.controller_props.placeholder =
                'https://api.mistral.ai/v1'
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
