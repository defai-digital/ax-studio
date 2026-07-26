/**
 * bootstrap-local-api — starts the local API server on app startup if enabled.
 * Pure async function; no React, no Zustand imports.
 */
import type { ServiceHub } from '@/services/index'
import { isElectronSmokeMode } from '@/lib/platform/utils'
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

let bootstrapLocalApiInFlight: Promise<BootstrapResult> | null = null

function getProxyUrl(config: LocalApiServerConfig) {
  return `http://${config.host}:${config.port}${config.prefix}`
}

async function isProxyAuthorized(
  config: LocalApiServerConfig,
  apiKey: string
): Promise<boolean | null> {
  try {
    const headers: Record<string, string> = {}
    if (apiKey.trim().length > 0) {
      headers.Authorization = `Bearer ${apiKey}`
    }

    const response = await fetch(`${getProxyUrl(config)}/models`, {
      method: 'GET',
      headers,
      cache: 'no-store',
    })

    if (response.status === 401 || response.status === 403) {
      return false
    }

    return true
  } catch (error) {
    console.warn('Unable to verify Local API Server auth state:', error)
    return null
  }
}

async function startLocalApiServer(
  config: LocalApiServerConfig,
  apiKey: string
): Promise<unknown> {
  return window.core?.api?.startServer({
    host: config.host,
    port: config.port,
    prefix: config.prefix,
    apiKey,
    trustedHosts: config.trustedHosts,
    isCorsEnabled: config.corsEnabled,
    isVerboseEnabled: config.verboseLogs,
    proxyTimeout: config.proxyTimeout,
  })
}

function isPortBindError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('Only one usage of each socket address') ||
    message.includes('Address already in use') ||
    message.includes('EADDRINUSE') ||
    message.includes('os error 10048')
  )
}

async function startLocalApiServerWithPortFallback(
  config: LocalApiServerConfig,
  apiKey: string
): Promise<number> {
  const attempts = [
    config.port,
    ...Array.from({ length: 10 }, (_, i) => config.port + i + 1),
  ]
  let lastError: unknown

  for (const port of attempts) {
    try {
      const actualPort = await startLocalApiServer({ ...config, port }, apiKey)
      return typeof actualPort === 'number' ? actualPort : port
    } catch (error) {
      lastError = error
      if (!isPortBindError(error)) {
        throw error
      }
      console.warn(
        `Local API Server port ${port} is unavailable; trying next port`,
        error
      )
    }
  }

  throw lastError
}

export async function bootstrapLocalApi(
  input: BootstrapLocalApiInput
): Promise<BootstrapResult> {
  const {
    serviceHub,
    enabled,
    config,
    setServerStatus,
    setServerPort,
    setApiKey,
  } = input

  // Electron smoke runs the proxy checks itself; the auto-start (default
  // port 31419) would race `start_server` and squat the ax-engine probe range.
  if (!enabled || isElectronSmokeMode()) return ok()

  if (bootstrapLocalApiInFlight) {
    setServerStatus('pending')

    const result = await bootstrapLocalApiInFlight
    setServerStatus(result.ok ? 'running' : 'stopped')
    return result
  }

  // Rust rejects empty API keys, so ensure we always send a non-empty one.
  const effectiveApiKey =
    config.apiKey && config.apiKey.trim().length > 0
      ? config.apiKey
      : 'ax-' +
        Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) =>
          b.toString(16).padStart(2, '0')
        ).join('')

  // Persist the effective key back to the Zustand store so that chat
  // requests (model-factory.ts, custom-chat-transport.ts) read the SAME
  // value and can attach it as a Bearer token.
  if (effectiveApiKey !== config.apiKey && setApiKey) {
    setApiKey(effectiveApiKey)
  }

  bootstrapLocalApiInFlight = (async () => {
    try {
      const isRunning = await serviceHub.app().getServerStatus()
      if (isRunning) {
        const authState = await isProxyAuthorized(config, effectiveApiKey)
        if (authState === false) {
          console.warn(
            'Local API Server token is stale; restarting with current key'
          )
          setServerStatus('pending')
          await window.core?.api?.stopServer()
        } else {
          console.info('Local API Server is already running')
          setServerStatus('running')
          return ok()
        }
      }

      if (!isRunning) {
        setServerStatus('pending')
      }

      const actualPort = await startLocalApiServerWithPortFallback(
        config,
        effectiveApiKey
      )

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
  })()

  try {
    return await bootstrapLocalApiInFlight
  } finally {
    bootstrapLocalApiInFlight = null
  }
}
