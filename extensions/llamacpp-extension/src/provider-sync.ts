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

export function decideLocalProviderSync(args: {
  loadedModels: string[]
  llamacppModels: string[]
  axServingModels: string[]
  axServingPort: number
  preferred?: LocalProviderSyncPreferred
  fallbackSession?: LocalProviderSyncFallbackSession
}): LocalProviderSyncDecision {
  const {
    loadedModels: rawLoadedModels,
    llamacppModels: rawLlamacppModels,
    axServingModels: rawAxServingModels,
    axServingPort,
    preferred,
    fallbackSession,
  } = args
  const loadedModels = normalizeModelIds(rawLoadedModels)
  const llamacppModels = normalizeModelIds(rawLlamacppModels)
  const axServingModels = normalizeModelIds(rawAxServingModels)

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

  if (axServingModels.length > 0 && axServingPort > 0) {
    return {
      action: 'register',
      port: axServingPort,
      apiKey: '',
      models: axServingModels,
    }
  }

  if (fallbackSession?.port && llamacppModels.length > 0) {
    if (!preferred?.models && llamacppModels.length > 1) {
      return { action: 'unregister' }
    }

    return {
      action: 'register',
      port: fallbackSession.port,
      apiKey: fallbackSession.api_key ?? '',
      models: normalizeModelIds(preferred?.models ?? [llamacppModels[0]]),
    }
  }

  return { action: 'skip' }
}
