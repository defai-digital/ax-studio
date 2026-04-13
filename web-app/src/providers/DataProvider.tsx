import { useModelProvider } from '@/hooks/models/useModelProvider'
import { useAppUpdater } from '@/hooks/updater/useAppUpdater'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useEffect, useCallback } from 'react'
import { useMCPServers, DEFAULT_MCP_SETTINGS } from '@/hooks/tools/useMCPServers'
import { useAssistant } from '@/hooks/chat/useAssistant'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useThreads } from '@/hooks/threads/useThreads'
import { useLocalApiServer } from '@/hooks/settings/useLocalApiServer'
import { useAppState } from '@/hooks/settings/useAppState'
import { isDev } from '@/lib/utils'
import { bootstrapProviders } from '@/lib/bootstrap/bootstrap-providers'
import { bootstrapThreads } from '@/lib/bootstrap/bootstrap-threads'
import { bootstrapUpdater } from '@/lib/bootstrap/bootstrap-updater'
import { bootstrapEvents } from '@/lib/bootstrap/bootstrap-events'
import { bootstrapLocalApi } from '@/lib/bootstrap/bootstrap-local-api'
import { syncRemoteProviders as syncRemoteProviderConfigs } from '@/lib/providers/provider-sync'

export function DataProvider() {
  const { setProviders, providers } = useModelProvider()
  const { checkForUpdate } = useAppUpdater()
  const { setServers, setSettings } = useMCPServers()
  const { setAssistants, initializeWithLastUsed } = useAssistant()
  const { setThreads } = useThreads()
  const navigate = useNavigate()
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

  // ─── Deep-link navigation handler (React-layer, needs useNavigate) ────────
  const handleDeepLink = useCallback(
    (urls: string[] | null) => {
      if (!urls) return
      const deeplink = urls[0]
      if (!deeplink) return
      let url: URL
      try {
        url = new URL(deeplink)
      } catch {
        console.error('Invalid deeplink URL:', deeplink)
        return
      }
      const params = url.pathname.split('/').filter((s) => s.length > 0)
      if (params.length < 3) return
      const resource = params.slice(1).join('/')
      // `route.hub.model` is `/hub/$modelId` — the `modelId` param is
      // required, otherwise TanStack Router throws at runtime.
      navigate({
        to: route.hub.model,
        params: { modelId: resource },
        search: { repo: resource },
      })
    },
    [navigate]
  )

  // ─── Effect 1: One-time startup bootstrap ────────────────────────────────
  // Runs once on mount (serviceHub is stable). Calls all startup units
  // concurrently where safe and handles each failure independently.
  useEffect(() => {
    let unmounted = false
    let cleanupDeepLink: () => void = () => {}
    let cleanupEvents: () => void = () => {}
    let cleanupUpdater: () => void = () => {}

    bootstrapProviders({
      serviceHub,
      setProviders,
      setServers,
      setSettings: (s) => setSettings(s ?? DEFAULT_MCP_SETTINGS),
      setAssistants,
      initializeWithLastUsed,
      onDeepLink: handleDeepLink,
    })
      .then(({ unsubscribeDeepLink }) => {
        if (unmounted) {
          // Component unmounted before bootstrap resolved — clean up immediately
          unsubscribeDeepLink()
        } else {
          cleanupDeepLink = unsubscribeDeepLink
        }
      })
      .catch((error) => {
        console.error('[DataProvider] bootstrapProviders failed:', error)
      })

    bootstrapThreads({ serviceHub, setThreads }).catch((error) => {
      console.error('[DataProvider] bootstrapThreads failed:', error)
    })

    cleanupUpdater = bootstrapUpdater({ checkForUpdate, isDev: isDev() })

    cleanupEvents = bootstrapEvents({ serviceHub, setProviders })

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
      cleanupDeepLink()
      cleanupEvents()
      cleanupUpdater()
    }
    // serviceHub is stable for the app lifetime; other deps are store actions
    // (stable Zustand references) or config values captured once at startup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceHub])

  // ─── Effect 2: Reactive remote provider sync ──────────────────────────────
  // Re-fires when providers change (e.g. user adds/removes a provider or key).
  useEffect(() => {
    void syncRemoteProviders(providers)
  }, [providers])

  return null
}

// ─── Standalone helpers ───────────────────────────────────────────────────────

async function syncRemoteProviders(providers: ModelProvider[]) {
  try {
    await syncRemoteProviderConfigs(providers)
  } catch (error) {
    console.error('Failed to sync remote providers:', error)
  }
}
