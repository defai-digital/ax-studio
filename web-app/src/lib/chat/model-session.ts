import type { ServiceHub } from '@/services'

const LOCAL_PROVIDER_IDS = new Set(['llamacpp', 'mlx', 'ollama'])

export function isLocalProvider(provider: ProviderObject): boolean {
  return LOCAL_PROVIDER_IDS.has(provider.provider)
}

export function assertProviderReadyForChat(provider: ProviderObject): void {
  if (!provider.api_key && !isLocalProvider(provider)) {
    throw new Error(
      `No API key configured for provider "${provider.provider}". ` +
        `Go to Settings -> AI Providers and add your API key.`
    )
  }
}

export async function prepareProviderForChat(
  serviceHub: ServiceHub,
  provider: ProviderObject,
  modelId: string
): Promise<void> {
  assertProviderReadyForChat(provider)

  if (isLocalProvider(provider)) {
    try {
      await serviceHub.models().startModel(provider, modelId)
    } catch (loadError) {
      throw new Error(
        `Failed to load model "${modelId}": ${formatErrorMessage(loadError)}`
      )
    }
  }
}

/**
 * Extract a human-readable message from any error shape.
 * Handles Error instances, Tauri plain-object errors ({code, message}),
 * strings, and arbitrary objects (via JSON.stringify fallback).
 */
function formatErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>
    if (typeof obj.message === 'string') return obj.message
    if (typeof obj.error === 'string') return obj.error
    try {
      return JSON.stringify(err)
    } catch {
      return Object.prototype.toString.call(err)
    }
  }
  return String(err)
}
