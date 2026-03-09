import { useModelProvider } from '@/hooks/useModelProvider'

import { useAppUpdater } from '@/hooks/useAppUpdater'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useEffect } from 'react'
import { useMCPServers, DEFAULT_MCP_SETTINGS } from '@/hooks/useMCPServers'
import { useAssistant } from '@/hooks/useAssistant'
import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useThreads } from '@/hooks/useThreads'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useAppState } from '@/hooks/useAppState'
import { AppEvent, events } from '@ax-studio/core'
import { SystemEvent } from '@/types/events'
import { isDev } from '@/lib/utils'
import { invoke } from '@tauri-apps/api/core'
import { deepLinkPayloadSchema } from '@/schemas/events.schema'
import { assistantsSchema } from '@/schemas/assistants.schema'

type ProviderCustomHeader = {
  header: string
  value: string
}

type RegisterProviderRequest = {
  provider: string
  api_key?: string
  base_url?: string
  custom_headers: ProviderCustomHeader[]
  models: string[]
}

// Batch-register all eligible remote providers in a single Tauri invoke call
async function registerRemoteProvidersBatch(providers: ModelProvider[]) {
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

  try {
    await invoke('register_provider_configs_batch', { requests })
    console.log(`Registered ${requests.length} remote providers in batch`)
  } catch (error) {
    console.error('Failed to batch-register providers:', error)
  }
}

// Effect to sync remote providers when providers change
const syncRemoteProviders = () => {
  const providers = useModelProvider.getState().providers
  const eligible = providers.filter((p) => p.active && p.api_key)
  if (eligible.length > 0) {
    registerRemoteProvidersBatch(eligible)
  }
}

export function DataProvider() {
  const { setProviders, providers } =
    useModelProvider()

  const { checkForUpdate } = useAppUpdater()
  const { setServers, setSettings } = useMCPServers()
  const { setAssistants, initializeWithLastUsed } = useAssistant()
  const { setThreads } = useThreads()
  const navigate = useNavigate()
  const serviceHub = useServiceHub()

  // Local API Server hooks
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

  useEffect(() => {
    console.log('Initializing DataProvider...')
    serviceHub.providers().getProviders().then((providers) => {
      setProviders(providers)
      // Register remote providers with the backend (batch)
      registerRemoteProvidersBatch(providers)
    }).catch((error) => {
      console.error('Failed to load providers:', error)
    })
    serviceHub
      .mcp()
      .getMCPConfig()
      .then((data) => {
        setServers(data.mcpServers ?? {})
        setSettings(data.mcpSettings ?? DEFAULT_MCP_SETTINGS)
      })
      .catch((error) => {
        console.error('Failed to load MCP config:', error)
      })
    serviceHub
      .assistants()
      .getAssistants()
      .then((data) => {
        const parsed = assistantsSchema.safeParse(data)
        if (parsed.success && parsed.data.length > 0) {
          setAssistants(parsed.data as Assistant[])
          initializeWithLastUsed()
        } else if (!parsed.success) {
          console.warn('Assistants data did not match expected schema:', parsed.error.message)
        }
      })
      .catch((error) => {
        console.warn('Failed to load assistants, keeping default:', error)
      })
    serviceHub.deeplink().getCurrent().then(handleDeepLink).catch((error) => {
      console.error('Failed to get current deep link:', error)
    })
    serviceHub.deeplink().onOpenUrl(handleDeepLink)

    // Listen for deep link events
    let unsubscribe = () => {}
    serviceHub
      .events()
      .listen(SystemEvent.DEEP_LINK, (event) => {
        const parsed = deepLinkPayloadSchema.safeParse(event.payload)
        if (!parsed.success) {
          console.error('Invalid deep link payload:', event.payload)
          return
        }
        handleDeepLink([parsed.data])
      })
      .then((unsub) => {
        unsubscribe = unsub
      })
    return () => {
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceHub])

  useEffect(() => {
    serviceHub
      .threads()
      .fetchThreads()
      .then((threads) => {
        setThreads(threads)
      })
  }, [serviceHub, setThreads])

  // Sync remote providers with backend when providers change.
  // `providers` comes from the reactive hook above so this effect re-fires
  // whenever a provider is added/removed or its API key / base URL changes.
  useEffect(() => {
    syncRemoteProviders()
  }, [providers])

  // Check for app updates - initial check and periodic interval
  useEffect(() => {
    // Only check for updates if the auto updater is not disabled
    // App might be distributed via other package managers
    // or methods that handle updates differently
    if (isDev()) {
      return
    }

    // Initial check on mount
    checkForUpdate()

    // Set up periodic update checks (singleton - only runs in DataProvider)
    const intervalId = setInterval(() => {
      console.log('Periodic update check triggered')
      checkForUpdate()
    }, Number(UPDATE_CHECK_INTERVAL_MS))

    // Cleanup interval on unmount
    return () => {
      clearInterval(intervalId)
    }
  }, [checkForUpdate])

  useEffect(() => {
    const handleModelImported = () => {
      serviceHub.providers().getProviders().then((providers) => {
        setProviders(providers)
        registerRemoteProvidersBatch(providers)
      })
    }
    events.on(AppEvent.onModelImported, handleModelImported)
    return () => {
      events.off(AppEvent.onModelImported, handleModelImported)
    }
  }, [serviceHub, setProviders])

  // Auto-start Local API Server on app startup if enabled
  useEffect(() => {
    if (enableOnStartup) {
      // Check if server is already running
      serviceHub
        .app()
        .getServerStatus()
        .then((isRunning) => {
          if (isRunning) {
            console.log('Local API Server is already running')
            setServerStatus('running')
            return
          }

          setServerStatus('pending')

          // Start the server directly without checking for model
          return window.core?.api
            ?.startServer({
              host: serverHost,
              port: serverPort,
              prefix: apiPrefix,
              apiKey,
              trustedHosts,
              isCorsEnabled: corsEnabled,
              isVerboseEnabled: verboseLogs,
              proxyTimeout: proxyTimeout,
            })
            .then((actualPort: number) => {
              // Store the actual port that was assigned (important for mobile with port 0)
              if (actualPort && actualPort !== serverPort) {
                setServerPort(actualPort)
              }
              setServerStatus('running')
            })
        })
        .catch((error: unknown) => {
          console.error('Failed to start Local API Server on startup:', error)
          setServerStatus('stopped')
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceHub])

  const handleDeepLink = (urls: string[] | null) => {
    if (!urls) return
    console.log('Received deeplink:', urls)
    const deeplink = urls[0]
    if (deeplink) {
      let url: URL
      try {
        url = new URL(deeplink)
      } catch {
        console.error('Invalid deeplink URL:', deeplink)
        return
      }
      const params = url.pathname.split('/').filter((str) => str.length > 0)

      if (params.length < 3) return undefined
      // const action = params[0]
      // const provider = params[1]
      const resource = params.slice(1).join('/')
      // return { action, provider, resource }
      navigate({
        to: route.hub.model,
        search: {
          repo: resource,
        },
      })
    }
  }

  return null
}
