import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { createSafeJSONStorage } from '@/lib/storage/storage'

const generateDefaultApiKey = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return (
    'ax-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  )
}

const DEFAULT_SERVER_HOST = '127.0.0.1'
const DEFAULT_SERVER_PORT = 31419
const DEFAULT_API_PREFIX = '/v1'
const DEFAULT_PROXY_TIMEOUT = 600
const MAX_TRUSTED_HOSTS = 200

type LocalApiServerState = {
  // Run local API server once app opens
  enableOnStartup: boolean
  setEnableOnStartup: (value: boolean) => void
  // Server host option (127.0.0.1 or 0.0.0.0)
  serverHost: '127.0.0.1' | '0.0.0.0'
  setServerHost: (value: '127.0.0.1' | '0.0.0.0') => void
  // Server port (default 31419)
  serverPort: number
  setServerPort: (value: number) => void
  // API prefix (default /v1)
  apiPrefix: string
  setApiPrefix: (value: string) => void
  // CORS enabled
  corsEnabled: boolean
  setCorsEnabled: (value: boolean) => void
  // Verbose server logs
  verboseLogs: boolean
  setVerboseLogs: (value: boolean) => void
  apiKey: string
  setApiKey: (value: string) => void
  // Trusted hosts
  trustedHosts: string[]
  setTrustedHosts: (hosts: string[]) => void
  addTrustedHost: (host: string) => void
  removeTrustedHost: (host: string) => void
  // Server request timeout (default 600 sec)
  proxyTimeout: number
  setProxyTimeout: (value: number) => void
}

type LocalApiServerPersistedSlice = Omit<
  LocalApiServerState,
  | 'setEnableOnStartup'
  | 'setServerHost'
  | 'setServerPort'
  | 'setApiPrefix'
  | 'setCorsEnabled'
  | 'setVerboseLogs'
  | 'setApiKey'
  | 'setTrustedHosts'
  | 'addTrustedHost'
  | 'removeTrustedHost'
  | 'setProxyTimeout'
>

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const normalizeHost = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const host = value.trim()
  return host ? host : null
}

const isServerHost = (
  value: unknown
): value is LocalApiServerState['serverHost'] => {
  return value === '127.0.0.1' || value === '0.0.0.0'
}

const isValidPort = (value: unknown): value is number => {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 65535
  )
}

const isValidTimeout = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

const sanitizeTrustedHosts = (
  value: unknown,
  fallback: string[]
): string[] => {
  if (!Array.isArray(value)) return fallback

  const hosts: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue

    const host = item.trim()
    if (!host || seen.has(host)) continue

    seen.add(host)
    hosts.push(host)
    if (hosts.length >= MAX_TRUSTED_HOSTS) break
  }

  return hosts
}

const sanitizeLocalApiServerSlice = (
  state: LocalApiServerState
): LocalApiServerPersistedSlice => ({
  enableOnStartup:
    typeof state.enableOnStartup === 'boolean' ? state.enableOnStartup : true,
  serverHost: isServerHost(state.serverHost)
    ? state.serverHost
    : DEFAULT_SERVER_HOST,
  serverPort: isValidPort(state.serverPort)
    ? state.serverPort
    : DEFAULT_SERVER_PORT,
  apiPrefix:
    typeof state.apiPrefix === 'string' ? state.apiPrefix : DEFAULT_API_PREFIX,
  corsEnabled: typeof state.corsEnabled === 'boolean' ? state.corsEnabled : true,
  verboseLogs:
    typeof state.verboseLogs === 'boolean' ? state.verboseLogs : true,
  trustedHosts: sanitizeTrustedHosts(state.trustedHosts, []),
  proxyTimeout: isValidTimeout(state.proxyTimeout)
    ? state.proxyTimeout
    : DEFAULT_PROXY_TIMEOUT,
  apiKey: typeof state.apiKey === 'string' ? state.apiKey : '',
})

const sanitizePersistedLocalApiServer = (
  persisted: unknown,
  current: LocalApiServerState
): LocalApiServerState => {
  if (!isRecord(persisted)) return current

  return {
    ...current,
    enableOnStartup:
      typeof persisted.enableOnStartup === 'boolean'
        ? persisted.enableOnStartup
        : current.enableOnStartup,
    serverHost: isServerHost(persisted.serverHost)
      ? persisted.serverHost
      : current.serverHost,
    serverPort: isValidPort(persisted.serverPort)
      ? persisted.serverPort
      : current.serverPort,
    apiPrefix:
      typeof persisted.apiPrefix === 'string'
        ? persisted.apiPrefix
        : current.apiPrefix,
    corsEnabled:
      typeof persisted.corsEnabled === 'boolean'
        ? persisted.corsEnabled
        : current.corsEnabled,
    verboseLogs:
      typeof persisted.verboseLogs === 'boolean'
        ? persisted.verboseLogs
        : current.verboseLogs,
    trustedHosts: sanitizeTrustedHosts(
      persisted.trustedHosts,
      current.trustedHosts
    ),
    proxyTimeout: isValidTimeout(persisted.proxyTimeout)
      ? persisted.proxyTimeout
      : current.proxyTimeout,
    apiKey:
      typeof persisted.apiKey === 'string' ? persisted.apiKey : current.apiKey,
  }
}

export const useLocalApiServer = create<LocalApiServerState>()(
  persist(
    (set) => ({
      enableOnStartup: true,
      setEnableOnStartup: (value) => {
        if (typeof value !== 'boolean') return
        set({ enableOnStartup: value })
      },
      serverHost: DEFAULT_SERVER_HOST,
      setServerHost: (value) => {
        if (!isServerHost(value)) return

        if (value === '0.0.0.0') {
          console.warn(
            'Binding to 0.0.0.0 exposes the local API server to all devices on your network. ' +
              'Ensure a strong API key is set.'
          )
        }
        set({ serverHost: value })
      },
      serverPort: DEFAULT_SERVER_PORT,
      setServerPort: (value) => {
        if (!isValidPort(value)) return
        set({ serverPort: value })
      },
      apiPrefix: DEFAULT_API_PREFIX,
      setApiPrefix: (value) => {
        if (typeof value !== 'string') return
        set({ apiPrefix: value })
      },
      // Default to true — the frontend webview (http://localhost:31420 in dev)
      // uses native fetch to hit the local proxy, which triggers CORS preflight.
      // Without this the browser rejects the request with "Load failed" before
      // any bytes hit the network.
      corsEnabled: true,
      setCorsEnabled: (value) => {
        if (typeof value !== 'boolean') return
        set({ corsEnabled: value })
      },
      verboseLogs: true,
      setVerboseLogs: (value) => {
        if (typeof value !== 'boolean') return
        set({ verboseLogs: value })
      },
      trustedHosts: [],
      setTrustedHosts: (hosts) =>
        set({ trustedHosts: sanitizeTrustedHosts(hosts, []) }),
      addTrustedHost: (host) =>
        set((state) => {
          const trustedHosts = sanitizeTrustedHosts(state.trustedHosts, [])
          const normalizedHost = normalizeHost(host)

          return !normalizedHost ||
            trustedHosts.includes(normalizedHost) ||
            trustedHosts.length >= MAX_TRUSTED_HOSTS
            ? state
            : { trustedHosts: [...trustedHosts, normalizedHost] }
        }),
      removeTrustedHost: (host) =>
        set((state) => {
          const trustedHosts = sanitizeTrustedHosts(state.trustedHosts, [])
          const normalizedHost = normalizeHost(host)
          if (!normalizedHost) return { trustedHosts }

          return {
            trustedHosts: trustedHosts.filter(
              (trustedHost) => trustedHost !== normalizedHost
            ),
          }
        }),
      proxyTimeout: DEFAULT_PROXY_TIMEOUT,
      setProxyTimeout: (value) => {
        if (!isValidTimeout(value)) return
        set({ proxyTimeout: value })
      },
      apiKey: generateDefaultApiKey(),
      setApiKey: (value) => {
        if (typeof value !== 'string') return
        set({ apiKey: value })
      },
    }),
    {
      name: localStorageKey.settingLocalApiServer,
      storage: createSafeJSONStorage(() => localStorage, 'useLocalApiServer'),
      merge: (persisted, current) =>
        sanitizePersistedLocalApiServer(persisted, current),
      partialize: sanitizeLocalApiServerSlice,
    }
  )
)
