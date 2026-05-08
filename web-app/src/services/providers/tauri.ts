/**
 * Tauri Providers Service - Desktop implementation
 */

import { models as providerModels } from 'token.js'
import { predefinedProviders } from '@/constants/providers'
import { EngineManager, SettingComponentProps } from '@ax-studio/core'
import { ModelCapabilities } from '@/types/models'
import { modelSettings } from '@/lib/predefined'
import { ExtensionManager } from '@/lib/extension'
import { fetch as fetchTauri } from '@tauri-apps/plugin-http'
import type { ProvidersService } from './types'
import { getModelCapabilities } from '@/lib/models'
import { providerModelsResponseSchema } from '@/schemas/providers.schema'
import { withTimeout } from '@/lib/utils/async'

const PROVIDER_LIST_TIMEOUT_MS = 8_000
const PROVIDER_SETTINGS_TIMEOUT_MS = 8_000
const PROVIDER_TOOL_CHECK_TIMEOUT_MS = 3_000

function providerErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    if (typeof record.message === 'string') return record.message
    if (typeof record.error === 'string') return record.error
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
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
      providerErrorMessage(error)
    )
    return fallback
  }
}

function shouldUseTauriFetch(baseUrl: string): boolean {
  return (
    baseUrl.includes('localhost:') ||
    baseUrl.includes('127.0.0.1:') ||
    baseUrl.includes('generativelanguage.googleapis.com')
  )
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
            provider: providerName,
            settings: Object.values(modelSettings).reduce(
              (acc, setting) => {
                let value = setting.controller_props.value
                if (setting.key === 'ctx_len') {
                  value = 8192
                }
                acc[setting.key] = {
                  ...setting,
                  controller_props: {
                    ...setting.controller_props,
                    value,
                  },
                }
                return acc
              },
              {} as Record<string, ProviderSetting>
            ),
          } as Model
        })
      ).catch((error: unknown) => {
        console.warn(
          `Error resolving models for provider "${providerName}":`,
          providerErrorMessage(error)
        )
        return [] as PromiseSettledResult<Model>[]
      })

      const resolvedModels = modelEntries
        .filter(
          (entry): entry is PromiseFulfilledResult<Model> =>
            entry.status === 'fulfilled'
        )
        .map((entry) => entry.value)

      if (resolvedModels.length === 0) {
        return null
      }

      return {
        active: true,
        persist: true,
        provider: providerName,
        base_url:
          'inferenceUrl' in value
            ? (value.inferenceUrl as string).replace('/chat/completions', '')
            : '',
        settings: settings.map((setting) => {
          return {
            key: setting.key,
            title: setting.title,
            description: setting.description,
            controller_type: setting.controllerType as unknown,
            controller_props: setting.controllerProps as unknown,
          }
        }) as ProviderSetting[],
        models: resolvedModels,
      } as ModelProvider
    })

    const runtimeProviders = (
      await Promise.all(runtimeProviderPromises)
    ).filter((provider): provider is ModelProvider => provider !== null)

    return runtimeProviders.concat(builtinProviders)
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
      if (provider.api_key) {
        if (provider.provider === 'gemini') {
          headers['x-goog-api-key'] = provider.api_key
        } else {
          headers['Authorization'] = `Bearer ${provider.api_key}`
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
        return []
      }

      const result = parsed.data
      if ('data' in result) {
        // OpenAI format: { data: [{ id: "model-id" }, ...] }
        return result.data.map((m) => m.id).filter(Boolean)
      } else if ('models' in result) {
        // Alternative format: { models: [...] }
        return result.models
          .map((m) => (typeof m === 'string' ? m : m.id))
          .filter(Boolean)
      } else {
        // Direct array format: ["model-id1", { id: "model-id2" }, ...]
        return (result as Array<string | { id: string }>)
          .map((m) => (typeof m === 'string' ? m : m.id))
          .filter(Boolean)
      }
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
      const message = providerErrorMessage(error)
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
      return ExtensionManager.getInstance()
        .getEngine(providerName)
        ?.updateSettings(
          settings.map((setting) => ({
            ...setting,
            controllerProps: {
              ...setting.controller_props,
              value:
                setting.controller_props.value !== undefined
                  ? setting.controller_props.value
                  : '',
            },
            controllerType: setting.controller_type,
          })) as SettingComponentProps[]
        )
    } catch (error) {
      console.error('Error updating settings in Tauri:', error)
      throw error
    }
  }
}
