import { invoke } from '@tauri-apps/api/core'
import { withTimeout } from './async'

export type LocalProviderSession = {
  port?: number
  api_key?: string
}

export interface LocalProviderConfigOptions {
  timeoutMs?: number
  modelId?: string
  models?: string[]
  apiKey?: string
  warningContext?: string
}

const DEFAULT_LOCAL_PROVIDER_CONFIG_TIMEOUT_MS = 1500
const DEFAULT_LOCAL_PROVIDER_WARNING_CONTEXT = 'local-provider'

function buildLocalProviderWarningMessage(
  modelId?: string,
  warningContext?: string
): string {
  const target = modelId ? `"${modelId}"` : 'provider'
  return `[${warningContext ?? DEFAULT_LOCAL_PROVIDER_WARNING_CONTEXT}] Local provider route registration did not complete for ${target}; continuing with proxy fallback.`
}

export function buildLocalProviderConfigRequest(
  provider: string,
  session?: LocalProviderSession,
  options: LocalProviderConfigOptions = {}
) {
  const port = Number(session?.port)
  if (!port || !Number.isFinite(port)) return null

  const models = options.models ?? (options.modelId ? [options.modelId] : [])

  return {
    request: {
      provider: provider.toLowerCase(),
      api_key: options.apiKey ?? session?.api_key ?? '',
      base_url: `http://127.0.0.1:${port}/v1`,
      custom_headers: [],
      models,
    },
  }
}

export async function registerLocalProviderRoute(
  provider: string,
  session: LocalProviderSession | undefined,
  options: LocalProviderConfigOptions = {}
): Promise<void> {
  const request = buildLocalProviderConfigRequest(provider, session, options)
  if (!request) return

  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCAL_PROVIDER_CONFIG_TIMEOUT_MS
  await withTimeout(
    invoke('register_provider_config', request),
    timeoutMs,
    `register_provider_config timed out after ${timeoutMs}ms`
  )
}

export async function registerLocalProviderRouteWithWarning(
  provider: string,
  session: LocalProviderSession | undefined,
  options: LocalProviderConfigOptions = {}
): Promise<void> {
  try {
    await registerLocalProviderRoute(provider, session, options)
  } catch (error) {
    const message = buildLocalProviderWarningMessage(options.modelId, options.warningContext)
    console.warn(message, error)
  }
}
