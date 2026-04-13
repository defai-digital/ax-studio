/**
 * bootstrap-local-api — starts the local API server on app startup if enabled.
 * Pure async function; no React, no Zustand imports.
 */
import type { ServiceHub } from '@/services/index'
import { type BootstrapResult, ok, fail } from './bootstrap-result'

export type LocalApiServerConfig = {
  host: string
  port: number
  prefix: string
  apiKey: string
  trustedHosts: string[]
  corsEnabled: boolean
  verboseLogs: boolean
  proxyTimeout: number
}

export type BootstrapLocalApiInput = {
  serviceHub: ServiceHub
  enabled: boolean
  config: LocalApiServerConfig
  setServerStatus: (status: 'pending' | 'running' | 'stopped') => void
  setServerPort: (port: number) => void
  /** Persist the apiKey the server actually launched with so the chat client
   *  can send the matching `Authorization: Bearer <key>` header. */
  setApiKey?: (key: string) => void
}

export async function bootstrapLocalApi(
  input: BootstrapLocalApiInput
): Promise<BootstrapResult> {
  const { serviceHub, enabled, config, setServerStatus, setServerPort, setApiKey } = input

  if (!enabled) return ok()

  try {
    const isRunning = await serviceHub.app().getServerStatus()
    if (isRunning) {
      console.log('Local API Server is already running')
      setServerStatus('running')
      return ok()
    }

    setServerStatus('pending')

    // Rust rejects empty API keys, so ensure we always send a non-empty one.
    const effectiveApiKey =
      config.apiKey && config.apiKey.trim().length > 0
        ? config.apiKey
        : 'ax-' +
          (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID().replace(/-/g, '')
            : Math.random().toString(36).slice(2) + Date.now().toString(36))

    // Persist the effective key back to the Zustand store so that chat
    // requests (model-factory.ts, custom-chat-transport.ts) read the SAME
    // value and can attach it as a Bearer token. Without this, the server
    // was booting with a generated key while the client kept reading '',
    // so every request to /v1/chat/completions hit 401 and the UI hung.
    if (effectiveApiKey !== config.apiKey && setApiKey) {
      setApiKey(effectiveApiKey)
    }

    // CORS must be enabled so the webview (different origin than the proxy
    // port) can actually reach the server via native fetch. Force it on here
    // to survive users whose persisted setting is still `false` from before
    // the default was changed. Since the proxy binds to 127.0.0.1 only, CORS
    // is not a security risk — without it, chat just hangs with "Load failed".
    const actualPort = await window.core?.api?.startServer({
      host: config.host,
      port: config.port,
      prefix: config.prefix,
      apiKey: effectiveApiKey,
      trustedHosts: config.trustedHosts,
      isCorsEnabled: true,
      isVerboseEnabled: config.verboseLogs,
      proxyTimeout: config.proxyTimeout,
    })

    if (actualPort && actualPort !== config.port) {
      setServerPort(actualPort)
    }
    setServerStatus('running')
    return ok()
  } catch (error) {
    console.error('Failed to start Local API Server on startup:', error)
    setServerStatus('stopped')
    return fail(error)
  }
}
