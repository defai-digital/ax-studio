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

let providersWork: Promise<ModelProvider[]> | null = null
let mcpConfigWork: Promise<{
  mcpServers?: Record<string, MCPServerConfig>
  mcpSettings?: MCPSettings | null
}> | null = null
let assistantsWork: Promise<unknown> | null = null

function getProvidersOnce(serviceHub: ServiceHub): Promise<ModelProvider[]> {
  providersWork ??= serviceHub
    .providers()
    .getProviders()
    .finally(() => {
      providersWork = null
    })
  return providersWork
}

function getMCPConfigOnce(serviceHub: ServiceHub) {
  mcpConfigWork ??= serviceHub
    .mcp()
    .getMCPConfig()
    .finally(() => {
      mcpConfigWork = null
    })
  return mcpConfigWork
}

function getAssistantsOnce(serviceHub: ServiceHub): Promise<unknown> {
  assistantsWork ??= serviceHub
    .assistants()
    .getAssistants()
    .finally(() => {
      assistantsWork = null
    })
  return assistantsWork
}

export type BootstrapProvidersInput = {
  serviceHub: ServiceHub
  setProviders: (
    providers: ModelProvider[],
    pathSep: string
  ) => boolean | void
  setServers: (servers: Record<string, MCPServerConfig>) => void
  setSettings: (settings: MCPSettings | null) => void
  setAssistants: (assistants: Assistant[]) => void
  initializeWithLastUsed: () => void
  onDeepLink: (urls: string[] | null) => void
  isCancelled?: () => boolean
}

/**
 * Loads providers, MCP config, and assistants concurrently.
 * Sets up deep link listener and returns its unsubscribe function.
 *
 * @returns { result, unsubscribeDeepLink }
 */
export async function bootstrapProviders(
  input: BootstrapProvidersInput
): Promise<{
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
    isCancelled: isExternallyCancelled = () => false,
  } = input

  let disposed = false
  let cleanedUp = false
  let unsubscribeDeepLink: () => void = () => {}
  let unsubscribeOnOpenUrl: (() => void) | undefined
  const isCancelled = () => disposed || isExternallyCancelled()
  const handleDeepLink = (urls: string[] | null) => {
    if (!isCancelled()) onDeepLink(urls)
  }

  const keepOrDispose = (
    unsubscribe: () => void,
    keep: (unsubscribe: () => void) => void
  ) => {
    if (isCancelled()) {
      unsubscribe()
    } else {
      keep(unsubscribe)
    }
  }
  const unsubscribeAll = () => {
    if (cleanedUp) return
    cleanedUp = true
    disposed = true
    const cleanups = [unsubscribeDeepLink, unsubscribeOnOpenUrl].filter(
      (cleanup): cleanup is () => void => cleanup != null
    )
    unsubscribeDeepLink = () => {}
    unsubscribeOnOpenUrl = undefined
    for (const cleanup of cleanups) {
      try {
        cleanup()
      } catch (error) {
        console.error('Failed to remove deep link listener:', error)
      }
    }
  }

  try {
    // Load providers, MCP config, and assistants concurrently with bounded waits.
    await Promise.all([
      withTimeout(
        getProvidersOnce(serviceHub).then((providers) => {
          if (isCancelled()) return
          const applied = setProviders(providers, serviceHub.path().sep())
          if (applied === false) return
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
        getMCPConfigOnce(serviceHub).then((data) => {
          if (isCancelled()) return
          setServers(data.mcpServers ?? {})
          setSettings(data.mcpSettings ?? null)
        }),
        MCP_BOOTSTRAP_TIMEOUT_MS,
        `MCP bootstrap timed out after ${MCP_BOOTSTRAP_TIMEOUT_MS}ms`
      ).catch((error) => {
        console.error('[bootstrap-providers] MCP bootstrap failed:', error)
      }),

      withTimeout(
        getAssistantsOnce(serviceHub).then((data) => {
          if (isCancelled()) return
          if (data == null) {
            setAssistants([])
            return
          }
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
        console.warn(
          '[bootstrap-providers] Assistants bootstrap failed:',
          error
        )
      }),
    ])

    if (isCancelled()) {
      disposed = true
      return { result: ok(), unsubscribeDeepLink: () => {} }
    }

    // Deep link: fetch current and register listener
    serviceHub
      .deeplink()
      .getCurrent()
      .then(handleDeepLink)
      .catch((error) => {
        console.error('Failed to get current deep link:', error)
      })
    serviceHub
      .deeplink()
      .onOpenUrl(handleDeepLink)
      .then((unsub) => {
        keepOrDispose(unsub, (cleanup) => {
          unsubscribeOnOpenUrl = cleanup
        })
      })
      .catch((error) => {
        console.error('Failed to register deep link listener:', error)
      })

    serviceHub
      .events()
      ?.listen(SystemEvent.DEEP_LINK, (event) => {
        if (isCancelled()) return
        const parsed = deepLinkPayloadSchema.safeParse(event.payload)
        if (!parsed.success) {
          console.error('Invalid deep link payload:', event.payload)
          return
        }
        onDeepLink([parsed.data])
      })
      .then((unsub) => {
        keepOrDispose(unsub, (cleanup) => {
          unsubscribeDeepLink = cleanup
        })
      })
      .catch((error) => {
        console.error('Failed to register deep link event listener:', error)
      })

    return { result: ok(), unsubscribeDeepLink: unsubscribeAll }
  } catch (error) {
    console.error('bootstrapProviders failed:', error)
    unsubscribeAll()
    return { result: fail(error), unsubscribeDeepLink: unsubscribeAll }
  }
}
