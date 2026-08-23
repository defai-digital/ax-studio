import { useModelProvider } from '@/hooks/models/useModelProvider'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useEffect, useRef } from 'react'
import { useThreads } from '@/hooks/threads/useThreads'
import { useLocalApiServer } from '@/hooks/settings/useLocalApiServer'
import { useAppState } from '@/hooks/settings/useAppState'
import { bootstrapProviders } from '@/lib/bootstrap/bootstrap-providers'
import { cleanupRemovedIntegrations } from '@/lib/bootstrap/removed-integration-cleanup'
import { bootstrapThreads } from '@/lib/bootstrap/bootstrap-threads'
import { bootstrapEvents } from '@/lib/bootstrap/bootstrap-events'
import { bootstrapLocalApi } from '@/lib/bootstrap/bootstrap-local-api'
import { syncRemoteProviders as syncRemoteProviderConfigs } from '@/lib/providers/provider-sync'

const PROVIDER_STARTUP_REFRESH_DELAYS_MS = [500, 1500, 3500, 7000] as const

export function DataProvider() {
  const { setProviders, providers } = useModelProvider()
  // Track whether the initial bootstrap sync has already registered providers.
  // Effect 2 must skip the first fire (triggered by bootstrapProviders setting
  // providers) to avoid registering every provider twice on startup.
  const bootstrapSyncDone = useRef(false)
  const { setThreads } = useThreads()
  const serviceHub = useServiceHub()

  const {
    enableOnStartup,
    serverHost,
    serverPort,
    setServerPort,
    apiPrefix,
    apiKey,
    setApiKey,
    trustedHosts,
    corsEnabled,
    verboseLogs,
    proxyTimeout,
  } = useLocalApiServer()
  const setServerStatus = useAppState((state) => state.setServerStatus)

  const startupSnapshot = useRef({
    serviceHub,
    setProviders,
    setThreads,
    enableOnStartup,
    serverHost,
    serverPort,
    setServerPort,
    apiPrefix,
    apiKey,
    setApiKey,
    trustedHosts,
    corsEnabled,
    verboseLogs,
    proxyTimeout,
    setServerStatus,
  })

  // ─── Effect 1: One-time startup bootstrap ────────────────────────────────
  // Runs once on mount from the initial startup snapshot. Later settings edits
  // are handled by their own settings flows and must not tear down startup
  // listeners, retry timers, or the updater interval.
  useEffect(() => {
    const {
      serviceHub,
      setProviders,
      setThreads,
      enableOnStartup,
      serverHost,
      serverPort,
      setServerPort,
      apiPrefix,
      apiKey,
      setApiKey,
      trustedHosts,
      corsEnabled,
      verboseLogs,
      proxyTimeout,
      setServerStatus,
    } = startupSnapshot.current
    let unmounted = false
    let cleanupEvents: () => void = () => {}
    const providerStartupRefreshTimers: ReturnType<typeof setTimeout>[] = []
    let providerRequestSequence = 0
    let latestAppliedProviderRequest = 0

    const applyProviderSnapshot = (
      requestSequence: number,
      providers: ModelProvider[],
      pathSep: string
    ) => {
      if (unmounted || requestSequence < latestAppliedProviderRequest) {
        return false
      }
      latestAppliedProviderRequest = requestSequence
      // Any applied startup snapshot has completed the initial registration.
      // This lets the reactive sync effect handle subsequent settings edits.
      bootstrapSyncDone.current = true
      setProviders(providers, pathSep)
      return true
    }

    const bootstrapProviderRequest = ++providerRequestSequence
    bootstrapProviders({
      serviceHub,
      setProviders: (providers, pathSep) => {
        return applyProviderSnapshot(
          bootstrapProviderRequest,
          providers,
          pathSep
        )
      },
      isCancelled: () => unmounted,
    }).catch((error) => {
      console.error('[DataProvider] bootstrapProviders failed:', error)
    })

    void cleanupRemovedIntegrations()

    bootstrapThreads({
      serviceHub,
      setThreads,
      isCancelled: () => unmounted,
    }).catch((error) => {
      console.error('[DataProvider] bootstrapThreads failed:', error)
    })

    cleanupEvents = bootstrapEvents({ serviceHub, setProviders })

    const refreshStartupProviders = () => {
      const requestSequence = ++providerRequestSequence
      serviceHub
        .providers()
        .getProviders()
        .then((providers) => {
          if (
            !applyProviderSnapshot(
              requestSequence,
              providers,
              serviceHub.path().sep()
            )
          ) {
            return
          }
          // Also push the latest provider list to the Rust proxy's registry so
          // it knows base_url + api_key + model_id mapping for every active
          // remote provider. Without this, providers added after the initial
          // bootstrap (e.g. the built-in `mlx` provider, or providers the user
          // edits in Settings) never get registered with the proxy and chat
          // requests for them fail with "No remote provider configured".
          void syncRemoteProviders(providers).catch((error) => {
            console.error('[DataProvider] startup remote provider sync failed:', error)
          })
        })
        .catch((error) => {
          console.error('[DataProvider] startup provider refresh failed:', error)
        })
    }

    for (const delayMs of PROVIDER_STARTUP_REFRESH_DELAYS_MS) {
      providerStartupRefreshTimers.push(setTimeout(refreshStartupProviders, delayMs))
    }

    bootstrapLocalApi({
      serviceHub,
      enabled: enableOnStartup,
      config: {
        host: serverHost,
        port: serverPort,
        prefix: apiPrefix,
        apiKey,
        trustedHosts,
        corsEnabled,
        verboseLogs,
        proxyTimeout,
      },
      setServerStatus,
      setServerPort,
      setApiKey,
    })

    return () => {
      unmounted = true
      cleanupEvents()
      providerStartupRefreshTimers.forEach(clearTimeout)
    }
  }, [])

  // ─── Effect 2: Reactive remote provider sync ──────────────────────────────
  // Re-fires when providers change (e.g. user adds/removes a provider or key).
  // Skips the first fire caused by bootstrapProviders — that sync already
  // happened inside Effect 1, so running it again would double-register
  // every provider (especially costly for providers with many models).
  useEffect(() => {
    if (!bootstrapSyncDone.current) return
    void syncRemoteProviders(providers, { authoritative: true }).catch(
      (error) => {
        console.error('[DataProvider] remote provider sync failed:', error)
      }
    )
  }, [providers])

  return null
}

// ─── Standalone helpers ───────────────────────────────────────────────────────

async function syncRemoteProviders(
  providers: ModelProvider[],
  options: { authoritative?: boolean } = {}
) {
  try {
    await syncRemoteProviderConfigs(providers, options)
  } catch (error) {
    console.error('Failed to sync remote providers:', error)
  }
}
