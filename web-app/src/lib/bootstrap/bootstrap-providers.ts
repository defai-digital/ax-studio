/**
 * bootstrap-providers — loads providers and warms the AX BI direct connection.
 * Pure async function; no React, no Zustand imports.
 *
 * Electron-only (migration matrix §2.2/§3): there is no MCP config to
 * bootstrap (AX BI connects directly via sdk.ts), no assistant extension
 * (a single built-in default assistant), and no deep links.
 */
import type { ServiceHub } from '@/services/index'
import { type BootstrapResult, ok, fail } from './bootstrap-result'
import { syncRemoteProviders } from '@/lib/providers/provider-sync'
import { withTimeout } from '@/lib/utils/async'

const PROVIDER_BOOTSTRAP_TIMEOUT_MS = 10_000

let providersWork: Promise<ModelProvider[]> | null = null

function getProvidersOnce(serviceHub: ServiceHub): Promise<ModelProvider[]> {
  providersWork ??= serviceHub
    .providers()
    .getProviders()
    .finally(() => {
      providersWork = null
    })
  return providersWork
}

export type BootstrapProvidersInput = {
  serviceHub: ServiceHub
  setProviders: (
    providers: ModelProvider[],
    pathSep: string
  ) => boolean | void
  isCancelled?: () => boolean
}

export async function bootstrapProviders(
  input: BootstrapProvidersInput
): Promise<{
  result: BootstrapResult
}> {
  const { serviceHub, setProviders, isCancelled = () => false } = input

  try {
    await withTimeout(
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
    })

    if (isCancelled()) return { result: ok() }

    // AX BI auto-reconnect — when a token exists, warm the direct client
    // (handshake + capabilities) in the background and update the connection
    // status store.
    try {
      const { probeAxBiDirectConnection } = await import(
        '@/lib/ax-bi/direct-client'
      )
      if (!isCancelled()) void probeAxBiDirectConnection()
    } catch (error) {
      console.warn('[bootstrap-providers] AX BI direct probe failed:', error)
    }

    return { result: ok() }
  } catch (error) {
    console.error('bootstrapProviders failed:', error)
    return { result: fail(error) }
  }
}
