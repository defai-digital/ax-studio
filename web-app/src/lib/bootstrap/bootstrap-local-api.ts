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
}

export async function bootstrapLocalApi(
  input: BootstrapLocalApiInput
): Promise<BootstrapResult> {
  const { serviceHub, enabled, config, setServerStatus, setServerPort } = input

  if (!enabled) return ok()

  try {
    const isRunning = await serviceHub.app().getServerStatus()
    if (isRunning) {
      console.log('Local API Server is already running')
      setServerStatus('running')
      return ok()
    }

    setServerStatus('pending')

    const actualPort = await window.core?.api?.startServer({
      host: config.host,
      port: config.port,
      prefix: config.prefix,
      apiKey: config.apiKey,
      trustedHosts: config.trustedHosts,
      isCorsEnabled: config.corsEnabled,
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
