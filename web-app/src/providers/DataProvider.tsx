import { useModelProvider } from '@/hooks/useModelProvider'
import { useAppUpdater } from '@/hooks/useAppUpdater'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useEffect, useCallback } from 'react'
import { useMCPServers, DEFAULT_MCP_SETTINGS } from '@/hooks/useMCPServers'
import { useAssistant } from '@/hooks/useAssistant'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useThreads } from '@/hooks/useThreads'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useAppState } from '@/hooks/useAppState'
import { isDev } from '@/lib/utils'
import { bootstrapProviders } from '@/lib/bootstrap/bootstrap-providers'
import { bootstrapThreads } from '@/lib/bootstrap/bootstrap-threads'
import { bootstrapUpdater } from '@/lib/bootstrap/bootstrap-updater'
import { bootstrapEvents } from '@/lib/bootstrap/bootstrap-events'
import { bootstrapLocalApi } from '@/lib/bootstrap/bootstrap-local-api'

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
      navigate({ to: route.hub.model, search: { repo: resource } })
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
    }).then(({ unsubscribeDeepLink }) => {
      if (unmounted) {
        // Component unmounted before bootstrap resolved — clean up immediately
        unsubscribeDeepLink()
      } else {
        cleanupDeepLink = unsubscribeDeepLink
      }
    })

    bootstrapThreads({ serviceHub, setThreads })

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
  const eligible = providers.filter((p) => p.active && p.api_key)
  if (eligible.length === 0) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const requests = eligible
      .filter((p) => !['llamacpp', 'mlx', 'ollama'].includes(p.provider))
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
    if (requests.length > 0) {
      await invoke('register_provider_configs_batch', { requests })
    }
  } catch (error) {
    console.error('Failed to sync remote providers:', error)
  }
}
