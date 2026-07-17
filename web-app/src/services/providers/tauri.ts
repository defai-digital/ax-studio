/**
 * Tauri Providers Service - Desktop implementation
 */

import { models as providerModels } from 'token.js'
import { predefinedProviders } from '@/constants/providers'
import { EngineManager } from '@ax-studio/core'
import { ModelCapabilities } from '@/types/models'
import { modelSettings } from '@/lib/predefined'
import { ExtensionManager } from '@/lib/extension'
import { fetch as fetchTauri } from '@tauri-apps/plugin-http'
import type { ProvidersService } from './types'
import { getModelCapabilities } from '@/lib/models'
import { providerModelsResponseSchema } from '@/schemas/providers.schema'
import { withTimeout } from '@/lib/utils/async'
import { extractErrorMessage } from '@/lib/utils/error'
import {
  buildRuntimeModelSettings,
  cloneProviderSettings,
  toSettingComponentPropsList,
} from './settings-mapper'

const PROVIDER_LIST_TIMEOUT_MS = 8_000
const PROVIDER_SETTINGS_TIMEOUT_MS = 8_000
const PROVIDER_TOOL_CHECK_TIMEOUT_MS = 3_000

type RuntimeModel = Model & {
  runtimeProviderName: string
}

function runtimeBaseUrl(value: unknown): string {
  if (value && typeof value === 'object' && 'inferenceUrl' in value) {
    return String((value as { inferenceUrl: string }).inferenceUrl).replace(
      '/chat/completions',
      ''
    )
  }
  return ''
}

function combineProviderLists(
  runtimeProviders: ModelProvider[],
  builtinProviders: ModelProvider[]
): ModelProvider[] {
  const providers = runtimeProviders.map((provider) => ({
    ...provider,
    models: [...(provider.models ?? [])],
  }))

  for (const builtinProvider of builtinProviders) {
    const existing = providers.find(
      (provider) => provider.provider === builtinProvider.provider
    )
    if (!existing) {
      providers.push(builtinProvider)
      continue
    }

    const existingModelIds = new Set((existing.models ?? []).map((model) => model.id))
    existing.models = [
      ...(existing.models ?? []),
      ...(builtinProvider.models ?? []).filter((model) => !existingModelIds.has(model.id)),
    ]
    existing.settings =
      existing.settings && existing.settings.length > 0
        ? existing.settings
        : builtinProvider.settings
    existing.base_url = existing.base_url || builtinProvider.base_url
    existing.api_key = existing.api_key || builtinProvider.api_key
    existing.explore_models_url =
      existing.explore_models_url || builtinProvider.explore_models_url
  }

  return providers
}

async function withProviderTimeout<T>(
  provider: string,
  label: string,
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  try {
    return await withTimeout(
      promise,
      timeoutMs,
      `${label} timed out for provider "${provider}"`
    )
  } catch (error) {
    console.warn(
      `Failed ${label} for provider "${provider}":`,
      extractErrorMessage(error)
    )
    return fallback
  }
}

function shouldUseTauriFetch(baseUrl: string): boolean {
  const host = providerUrlHostname(baseUrl)
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === 'generativelanguage.googleapis.com'
  )
}

function usesOpenAICompatibleAuth(provider: ModelProvider, baseUrl: string): boolean {
  if (provider.provider !== 'gemini') return true
  return providerUrlPathname(baseUrl).includes('/openai')
}

function normalizeProviderApiKey(apiKey?: string): string | undefined {
  const trimmed = apiKey?.trim()
  if (!trimmed) return undefined
  return trimmed.replace(/^Bearer\s+/i, '').trim() || undefined
}

function providerUrl(baseUrl: string): URL | undefined {
  try {
    return new URL(baseUrl.trim())
  } catch {
    return undefined
  }
}

function providerUrlHostname(baseUrl: string): string {
  return providerUrl(baseUrl)?.hostname.toLowerCase() ?? ''
}

function providerUrlPathname(baseUrl: string): string {
  return providerUrl(baseUrl)?.pathname.toLowerCase() ?? ''
}

function providerUrlHostMatches(baseUrl: string, host: string): boolean {
  const parsedHost = providerUrlHostname(baseUrl)
  return parsedHost === host || parsedHost.endsWith(`.${host}`)
}

const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const RESERVED_CUSTOM_HEADERS = new Set([
  'accept-encoding',
  'authorization',
  'connection',
  'content-length',
  'cookie',
  'forwarded',
  'host',
  'origin',
  'proxy-authorization',
  'proxy-connection',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'x-api-key',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
])

const ALIBABA_FALLBACK_MODELS = [
  'qwen-plus',
  'qwen-turbo',
  'qwen-max',
  'qwen3-coder-plus',
  'qwen3-coder-next',
]

function isAlibabaCompatibleProvider(provider: ModelProvider, baseUrl: string): boolean {
  const providerName = provider.provider.toLowerCase()
  const parsedUrl = providerUrl(baseUrl)
  return (
    providerName.includes('alibaba') ||
    providerName.includes('aliyun') ||
    providerName.includes('dashscope') ||
    providerName.includes('qwen') ||
    providerUrlHostMatches(baseUrl, 'dashscope.aliyuncs.com') ||
    (parsedUrl?.hostname.toLowerCase().endsWith('.aliyuncs.com') === true &&
      parsedUrl.pathname.toLowerCase().includes('/compatible-mode'))
  )
}

function withProviderFallbackModels(
  provider: ModelProvider,
  baseUrl: string,
  modelIds: string[]
): string[] {
  if (modelIds.length > 0) return modelIds
  if (isAlibabaCompatibleProvider(provider, baseUrl)) {
    return ALIBABA_FALLBACK_MODELS
  }
  return modelIds
}

function isSafeCustomHeader(header: { header: string; value: string }): boolean {
  const name = header.header.trim()
  const lowerName = name.toLowerCase()
  if (!HEADER_NAME_PATTERN.test(name)) return false
  if (RESERVED_CUSTOM_HEADERS.has(lowerName)) return false
  if (lowerName.startsWith('proxy-') || lowerName.startsWith('sec-')) return false
  return !/[\0\r\n]/.test(header.value)
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text.slice(0, 300)
  } catch {
    return ''
  }
}

export class TauriProvidersService implements ProvidersService {
  fetch(): typeof fetch {
    // Tauri implementation uses Tauri's fetch to avoid CORS issues
    return fetchTauri as typeof fetch
  }

  async getProviders(): Promise<ModelProvider[]> {
    // Built-in cloud providers are safe to build without any I/O, so compute
    // them outside the per-engine try/catch — a failure in a single local
    // engine must not hide working cloud providers from the UI.
    let builtinProviders: ModelProvider[] = []
    try {
      builtinProviders = predefinedProviders.map((provider) => {
        let models = provider.models as Model[]
        if (Object.keys(providerModels).includes(provider.provider)) {
          const providerKey = provider.provider as keyof typeof providerModels
          const builtInModels = (providerModels[providerKey]?.models ?? []) as unknown as string[]

          if (Array.isArray(builtInModels)) {
            models = builtInModels.map((model) => {
              const modelManifest = models.find((e) => e.id === model)
              // TODO: Check chat_template for tool call support
              return {
                ...(modelManifest ?? { id: model, name: model }),
                capabilities: getModelCapabilities(provider.provider, model),
              } as Model
            })
          }
        }

        return {
          ...provider,
          models,
        }
      }).filter(Boolean) as ModelProvider[]
    } catch (error) {
      console.error('Error building built-in providers list:', error)
    }

    const runtimeProviderPromises = Array.from(
      EngineManager.instance().engines.entries()
    ).map(async ([providerName, value]) => {
      const runtimeDefaultSettings = buildRuntimeModelSettings(
        Object.values(modelSettings)
      )
      const models = await withProviderTimeout(
        providerName,
        'listing models',
        value.list(),
        PROVIDER_LIST_TIMEOUT_MS,
        []
      )

      if (models.length === 0) {
        return null
      }

      const settings = await withProviderTimeout(
        providerName,
        'loading settings',
        value.getSettings(),
        PROVIDER_SETTINGS_TIMEOUT_MS,
        []
      )

      const modelEntries = await Promise.allSettled(
        models.map(async (model) => {
          const runtimeProviderName = model.providerId || providerName
          let capabilities: string[] = []
          if ('capabilities' in model && Array.isArray(model.capabilities)) {
            capabilities = [...(model.capabilities as string[])]
          }

          if (!capabilities.includes(ModelCapabilities.TOOLS)) {
            const toolSupported = await withProviderTimeout(
              providerName,
              `tool support check (${model.id})`,
              value.isToolSupported(model.id),
              PROVIDER_TOOL_CHECK_TIMEOUT_MS,
              false
            )

            if (toolSupported) {
              capabilities.push(ModelCapabilities.TOOLS)
            }
          }

          if (model.embedding && !capabilities.includes(ModelCapabilities.EMBEDDINGS)) {
            capabilities = [...capabilities, ModelCapabilities.EMBEDDINGS]
          }

          return {
            id: model.id,
            model: model.id,
            name: model.name,
            description: model.description,
            capabilities,
            embedding: model.embedding,
            runtimeProviderName,
            settings: cloneProviderSettings(runtimeDefaultSettings),
          } as RuntimeModel
        })
      ).catch((error: unknown) => {
        console.warn(
          `Error resolving models for provider "${providerName}":`,
          extractErrorMessage(error)
        )
        return [] as PromiseSettledResult<RuntimeModel>[]
      })

      const resolvedModels = modelEntries
        .filter(
          (entry): entry is PromiseFulfilledResult<RuntimeModel> =>
            entry.status === 'fulfilled'
        )
        .map((entry) => entry.value)

      const groupedModels = resolvedModels.reduce<Map<string, Model[]>>(
        (groups, model) => {
          const group = groups.get(model.runtimeProviderName) ?? []
          group.push(model)
          groups.set(model.runtimeProviderName, group)
          return groups
        },
        new Map()
      )

      if (groupedModels.size === 0) {
        return null
      }

      const mappedSettings = buildRuntimeModelSettings(settings)
      return Array.from(groupedModels.entries()).map(
        ([runtimeProviderName, models]) =>
          ({
            active: true,
            persist: true,
            provider: runtimeProviderName,
            base_url:
              runtimeProviderName === providerName ? runtimeBaseUrl(value) : '',
            settings:
              runtimeProviderName === providerName ? mappedSettings : [],
            models,
          }) as ModelProvider
      )
    })

    const runtimeProviders = (
      await Promise.all(runtimeProviderPromises)
    )
      .flatMap((provider) => provider ?? [])
      .filter((provider): provider is ModelProvider => provider !== null)

    return combineProviderLists(runtimeProviders, builtinProviders)
  }

  async fetchModelsFromProvider(provider: ModelProvider): Promise<string[]> {
    const baseUrl = provider.base_url?.trim().replace(/\/+$/, '')
    if (!baseUrl) {
      throw new Error('Provider must have base_url configured')
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      controller.abort()
    }, 10000)

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      // Add Origin header for local providers to avoid CORS issues
      // Some local providers (like Ollama) require an Origin header
      const useTauriFetch = shouldUseTauriFetch(baseUrl)
      if (useTauriFetch) {
        headers['Origin'] = 'tauri://localhost'
      }

      // Only add authentication headers if API key is provided
      const apiKey = normalizeProviderApiKey(provider.api_key)
      if (apiKey) {
        if (!usesOpenAICompatibleAuth(provider, baseUrl)) {
          headers['x-goog-api-key'] = apiKey
        } else {
          headers['Authorization'] = `Bearer ${apiKey}`
        }
      }

      if (provider.custom_header) {
        provider.custom_header.forEach((header) => {
          if (isSafeCustomHeader(header)) {
            headers[header.header.trim()] = header.value
          } else {
            console.warn(`Skipped unsafe custom provider header: ${header.header}`)
          }
        })
      }

      // Use native fetch for remote HTTPS providers so CSP/browser diagnostics
      // stay accurate; keep Tauri fetch for localhost providers that need CORS help.
      const fetchImpl = useTauriFetch ? fetchTauri : globalThis.fetch
      const response = await fetchImpl(`${baseUrl}/models`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorBody = await readErrorBody(response)
        const details = errorBody ? `: ${errorBody}` : ''
        // Provide more specific error messages based on status code (aligned with web implementation)
        if (response.status === 401) {
          throw new Error(
            `Authentication failed: API key is required or invalid for ${provider.provider}${details}`
          )
        } else if (response.status === 403) {
          throw new Error(
            `Access forbidden: Check your API key permissions for ${provider.provider}${details}`
          )
        } else if (response.status === 404) {
          throw new Error(
            `Models endpoint not found for ${provider.provider}. Check the base URL configuration.${details}`
          )
        } else {
          throw new Error(
            `Failed to fetch models from ${provider.provider}: ${response.status} ${response.statusText}${details}`
          )
        }
      }

      const data = await response.json()
      const parsed = providerModelsResponseSchema.safeParse(data)
      if (!parsed.success) {
        console.warn('Unexpected response format from provider API:', data)
        return withProviderFallbackModels(provider, baseUrl, [])
      }

      const result = parsed.data
      let modelIds: string[]
      if ('data' in result) {
        // OpenAI format: { data: [{ id: "model-id" }, ...] }
        modelIds = result.data.map((m) => m.id).filter(Boolean)
      } else if ('models' in result) {
        // Alternative format: { models: [...] }
        modelIds = result.models
          .map((m) => (typeof m === 'string' ? m : m.id))
          .filter(Boolean)
      } else {
        // Direct array format: ["model-id1", { id: "model-id2" }, ...]
        modelIds = (result as Array<string | { id: string }>)
          .map((m) => (typeof m === 'string' ? m : m.id))
          .filter(Boolean)
      }
      return withProviderFallbackModels(provider, baseUrl, modelIds)
    } catch (error) {
      console.error('Error fetching models from provider:', error)

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `Timed out while fetching models from ${provider.provider}.`
        )
      }

      // Preserve structured error messages thrown above
      const structuredErrorPrefixes = [
        'Authentication failed',
        'Access forbidden',
        'Models endpoint not found',
        'Failed to fetch models from',
      ]

      if (
        error instanceof Error &&
        structuredErrorPrefixes.some((prefix) =>
          (error as Error).message.startsWith(prefix)
        )
      ) {
        throw new Error(error.message)
      }

      // Provide helpful error message for any connection errors
      const message = extractErrorMessage(error)
      if (message.includes('fetch')) {
        throw new Error(
          `Cannot connect to ${provider.provider} at ${baseUrl}. Please check that the service is running and accessible.`
        )
      }

      // Generic fallback
      throw new Error(
        `Unexpected error while fetching models from ${provider.provider}: ${message}`
      )
    } finally {
      clearTimeout(timeoutId)
    }
  }

  async updateSettings(
    providerName: string,
    settings: ProviderSetting[]
  ): Promise<void> {
    try {
      const engine = ExtensionManager.getInstance().getEngine(providerName)
      if (!engine) {
        return
      }

      await engine.updateSettings(toSettingComponentPropsList(settings))
    } catch (error) {
      console.error('Error updating settings in Tauri:', error)
      throw error
    }
  }
}
