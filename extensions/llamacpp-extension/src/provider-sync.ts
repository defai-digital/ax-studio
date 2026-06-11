export type LocalProviderSyncPreferred = {
  port?: number
  apiKey?: string
  models?: string[]
}

export type LocalProviderSyncFallbackSession = {
  port?: number
  api_key?: string
} | null

export type LocalProviderSyncDecision =
  | {
      action: 'unregister'
    }
  | {
      action: 'skip'
    }
  | {
      action: 'register'
      port: number
      apiKey: string
      models: string[]
    }

function normalizeModelIds(models: string[]): string[] {
  return [...new Set(models)].sort((a, b) => a.localeCompare(b))
}

/**
 * Decide how to register the local provider with the Rust proxy.
 * Every loaded model (llama-server or ax-engine-server) runs in its own
 * process with its own port, so without an explicit preference only a
 * single loaded model can be routed.
 */
export function decideLocalProviderSync(args: {
  loadedModels: string[]
  preferred?: LocalProviderSyncPreferred
  fallbackSession?: LocalProviderSyncFallbackSession
}): LocalProviderSyncDecision {
  const { loadedModels: rawLoadedModels, preferred, fallbackSession } = args
  const loadedModels = normalizeModelIds(rawLoadedModels)

  if (loadedModels.length === 0) {
    return { action: 'unregister' }
  }

  if (preferred?.port) {
    return {
      action: 'register',
      port: preferred.port,
      apiKey: preferred.apiKey ?? '',
      models: normalizeModelIds(preferred.models ?? loadedModels),
    }
  }

  if (fallbackSession?.port) {
    if (!preferred?.models && loadedModels.length > 1) {
      return { action: 'unregister' }
    }

    return {
      action: 'register',
      port: fallbackSession.port,
      apiKey: fallbackSession.api_key ?? '',
      models: normalizeModelIds(preferred?.models ?? [loadedModels[0]]),
    }
  }

  return { action: 'skip' }
}
