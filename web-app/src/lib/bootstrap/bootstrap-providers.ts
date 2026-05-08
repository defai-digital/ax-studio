/**
 * bootstrap-providers — loads providers, MCP config, assistants, and sets up deep link handling.
 * Pure async function; no React, no Zustand imports.
 *
 * Returns an unsubscribe function for the deep-link event listener.
 */
import type { ServiceHub } from '@/services/index'
import type { MCPServerConfig, MCPSettings } from '@/hooks/tools/useMCPServers'
import { deepLinkPayloadSchema } from '@/schemas/events.schema'
import { assistantsSchema } from '@/schemas/assistants.schema'
import { SystemEvent } from '@/types/events'
import { type BootstrapResult, ok, fail } from './bootstrap-result'
import { syncRemoteProviders } from '@/lib/providers/provider-sync'
import { withTimeout } from '@/lib/utils/async'

const PROVIDER_BOOTSTRAP_TIMEOUT_MS = 10_000
const MCP_BOOTSTRAP_TIMEOUT_MS = 8_000
const ASSISTANTS_BOOTSTRAP_TIMEOUT_MS = 8_000

export type BootstrapProvidersInput = {
  serviceHub: ServiceHub
  setProviders: (providers: ModelProvider[], pathSep: string) => void
  setServers: (servers: Record<string, MCPServerConfig>) => void
  setSettings: (settings: MCPSettings | null) => void
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
    // Load providers, MCP config, and assistants concurrently with bounded waits.
    await Promise.all([
      withTimeout(
        serviceHub
          .providers()
          .getProviders()
          .then((providers) => {
            setProviders(providers, serviceHub.path().sep())
            return syncRemoteProviders(providers).catch((err) =>
              console.error('Failed to batch-register providers:', err)
            )
          }),
        PROVIDER_BOOTSTRAP_TIMEOUT_MS,
        `Provider bootstrap timed out after ${PROVIDER_BOOTSTRAP_TIMEOUT_MS}ms`
      ).catch((error) => {
        console.error('[bootstrap-providers] Provider bootstrap failed:', error)
      }),

      withTimeout(
        serviceHub
          .mcp()
          .getMCPConfig()
          .then((data) => {
            setServers(data.mcpServers ?? {})
            setSettings(data.mcpSettings ?? null)
          }),
        MCP_BOOTSTRAP_TIMEOUT_MS,
        `MCP bootstrap timed out after ${MCP_BOOTSTRAP_TIMEOUT_MS}ms`
      ).catch((error) => {
        console.error('[bootstrap-providers] MCP bootstrap failed:', error)
      }),

      withTimeout(
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
          }),
        ASSISTANTS_BOOTSTRAP_TIMEOUT_MS,
        `Assistants bootstrap timed out after ${ASSISTANTS_BOOTSTRAP_TIMEOUT_MS}ms`
      ).catch((error) => {
        console.warn('[bootstrap-providers] Assistants bootstrap failed:', error)
      }),
    ])

    // Deep link: fetch current and register listener
    serviceHub.deeplink().getCurrent().then(onDeepLink).catch((error) => {
      console.error('Failed to get current deep link:', error)
    })
    let unsubscribeOnOpenUrl: (() => void) | undefined
    serviceHub.deeplink().onOpenUrl(onDeepLink).then((unsub) => {
      unsubscribeOnOpenUrl = unsub
    }).catch((error) => {
      console.error('Failed to register deep link listener:', error)
    })

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

    const unsubscribeAll = () => {
      unsubscribeDeepLink()
      unsubscribeOnOpenUrl?.()
    }
    return { result: ok(), unsubscribeDeepLink: unsubscribeAll }
  } catch (error) {
    console.error('bootstrapProviders failed:', error)
    return { result: fail(error), unsubscribeDeepLink }
  }
}
