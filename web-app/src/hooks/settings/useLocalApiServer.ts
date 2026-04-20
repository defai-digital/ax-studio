import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { createSafeJSONStorage } from '@/lib/storage'

const generateDefaultApiKey = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return 'ax-' + crypto.randomUUID().replace(/-/g, '')
  }
  return 'ax-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

type LocalApiServerState = {
  // Run local API server once app opens
  enableOnStartup: boolean
  setEnableOnStartup: (value: boolean) => void
  // Server host option (127.0.0.1 or 0.0.0.0)
  serverHost: '127.0.0.1' | '0.0.0.0'
  setServerHost: (value: '127.0.0.1' | '0.0.0.0') => void
  // Server port (default 1337)
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
  addTrustedHost: (host: string) => void
  removeTrustedHost: (host: string) => void
  setTrustedHosts: (hosts: string[]) => void
  // Server request timeout (default 600 sec)
  proxyTimeout: number
  setProxyTimeout: (value: number) => void
}

export const useLocalApiServer = create<LocalApiServerState>()(
  persist(
    (set) => ({
      enableOnStartup: true,
      setEnableOnStartup: (value) => set({ enableOnStartup: value }),
      serverHost: '127.0.0.1',
      setServerHost: (value) => {
        if (value === '0.0.0.0') {
          console.warn(
            'Binding to 0.0.0.0 exposes the local API server to all devices on your network. ' +
            'Ensure a strong API key is set.'
          )
        }
        set({ serverHost: value })
      },
      serverPort: 1337,
      setServerPort: (value) => set({ serverPort: value }),
      apiPrefix: '/v1',
      setApiPrefix: (value) => set({ apiPrefix: value }),
      // Default to true — the frontend webview (http://localhost:1420 in dev)
      // uses native fetch to hit the local proxy, which triggers CORS preflight.
      // Without this the browser rejects the request with "Load failed" before
      // any bytes hit the network.
      corsEnabled: true,
      setCorsEnabled: (value) => set({ corsEnabled: value }),
      verboseLogs: true,
      setVerboseLogs: (value) => set({ verboseLogs: value }),
      trustedHosts: [],
      addTrustedHost: (host) =>
        set((state) => ({
          trustedHosts: [...state.trustedHosts, host],
        })),
      removeTrustedHost: (host) =>
        set((state) => ({
          trustedHosts: state.trustedHosts.filter((h) => h !== host),
        })),
      setTrustedHosts: (hosts) => set({ trustedHosts: hosts }),
      proxyTimeout: 600,
      setProxyTimeout: (value) => set({ proxyTimeout: value }),
      apiKey: generateDefaultApiKey(),
      setApiKey: (value) => set({ apiKey: value }),
    }),
    {
      name: localStorageKey.settingLocalApiServer,
      storage: createSafeJSONStorage(() => localStorage, 'useLocalApiServer'),
    }
  )
)
