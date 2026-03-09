/**
 * bootstrap-providers — loads providers, MCP config, assistants, and sets up deep link handling.
 * Pure async function; no React, no Zustand imports.
 *
 * Returns an unsubscribe function for the deep-link event listener.
 */
import type { ServiceHub } from '@/services/index'
import type { MCPServerConfig, MCPSettings } from '@/hooks/useMCPServers'
import { deepLinkPayloadSchema } from '@/schemas/events.schema'
import { assistantsSchema } from '@/schemas/assistants.schema'
import { SystemEvent } from '@/types/events'
import { type BootstrapResult, ok, fail } from './bootstrap-result'
import { invoke } from '@tauri-apps/api/core'

type ProviderCustomHeader = { header: string; value: string }
type RegisterProviderRequest = {
  provider: string
  api_key?: string
  base_url?: string
  custom_headers: ProviderCustomHeader[]
  models: string[]
}

async function registerRemoteProvidersBatch(providers: ModelProvider[]): Promise<void> {
  const requests: RegisterProviderRequest[] = providers
    .filter((p) => !['llamacpp', 'mlx', 'ollama'].includes(p.provider) && p.api_key)
    .map((p) => ({
      provider: p.provider,
      api_key: p.api_key,
      base_url: p.base_url,
      custom_headers: (p.custom_header || []).map((h) => ({
        header: h.header,
        value: h.value,
      })),
      models: p.models.map((e) => e.id),
    }))

  if (requests.length === 0) return

  await invoke('register_provider_configs_batch', { requests })
}

export type BootstrapProvidersInput = {
  serviceHub: ServiceHub
  setProviders: (providers: ModelProvider[], pathSep: string) => void
  setServers: (servers: Record<string, MCPServerConfig>) => void
  setSettings: (settings: MCPSettings) => void
  setAssistants: (assistants: Assistant[]) => void
  initializeWithLastUsed: () => void
  onDeepLink: (urls: string[] | null) => void
}

/**
 * Loads providers, MCP config, and assistants concurrently.
 * Sets up deep link listener and returns its unsubscribe function.
 *
 * @returns { result, unsubscribeDeepLink }
 */
export async function bootstrapProviders(input: BootstrapProvidersInput): Promise<{
  result: BootstrapResult
  unsubscribeDeepLink: () => void
}> {
  const {
    serviceHub,
    setProviders,
    setServers,
    setSettings,
    setAssistants,
    initializeWithLastUsed,
    onDeepLink,
  } = input

  let unsubscribeDeepLink: () => void = () => {}

  try {
    // Load providers, MCP config, and assistants concurrently
    await Promise.all([
      serviceHub
        .providers()
        .getProviders()
        .then((providers) => {
          setProviders(providers, serviceHub.path().sep())
          return registerRemoteProvidersBatch(providers).catch((err) =>
            console.error('Failed to batch-register providers:', err)
          )
        })
        .catch((error) => {
          console.error('Failed to load providers:', error)
        }),

      serviceHub
        .mcp()
        .getMCPConfig()
        .then((data) => {
          setServers(data.mcpServers ?? {})
          setSettings(data.mcpSettings ?? null)
        })
        .catch((error) => {
          console.error('Failed to load MCP config:', error)
        }),

      serviceHub
        .assistants()
        .getAssistants()
        .then((data) => {
          const parsed = assistantsSchema.safeParse(data)
          if (parsed.success && parsed.data.length > 0) {
            setAssistants(parsed.data as Assistant[])
            initializeWithLastUsed()
          } else if (!parsed.success) {
            console.warn(
              'Assistants data did not match expected schema:',
              parsed.error.message
            )
          }
        })
        .catch((error) => {
          console.warn('Failed to load assistants, keeping default:', error)
        }),
    ])

    // Deep link: fetch current and register listener
    serviceHub.deeplink().getCurrent().then(onDeepLink).catch((error) => {
      console.error('Failed to get current deep link:', error)
    })
    serviceHub.deeplink().onOpenUrl(onDeepLink)

    serviceHub
      .events()
      .listen(SystemEvent.DEEP_LINK, (event) => {
        const parsed = deepLinkPayloadSchema.safeParse(event.payload)
        if (!parsed.success) {
          console.error('Invalid deep link payload:', event.payload)
          return
        }
        onDeepLink([parsed.data])
      })
      .then((unsub) => {
        unsubscribeDeepLink = unsub
      })

    return { result: ok(), unsubscribeDeepLink }
  } catch (error) {
    console.error('bootstrapProviders failed:', error)
    return { result: fail(error), unsubscribeDeepLink }
  }
}
