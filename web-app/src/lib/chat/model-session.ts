import type { ServiceHub } from '@/services'
import { LOCAL_PROVIDER_IDS } from '@/constants/providers'
import { extractErrorMessage } from '@/lib/utils/error'

export function isLocalProvider(provider: ProviderObject): boolean {
  return LOCAL_PROVIDER_IDS.has(provider.provider)
}

function assertProviderReadyForChat(provider: ProviderObject): void {
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

  // Ollama owns model loading in its existing HTTP server. It has no bundled
  // engine extension; register its endpoint before the proxy sends the chat.
  if (provider.provider === 'ollama') {
    await serviceHub.core().invoke('register_provider_config', {
      provider: provider.provider,
      base_url: provider.base_url?.trim() || 'http://127.0.0.1:11434/v1',
      api_key: provider.api_key || '',
      custom_headers: provider.custom_header ?? [],
      models: Array.from(
        new Set([...provider.models.map((model) => model.id), modelId])
      ),
    })
    return
  }

  if (isLocalProvider(provider)) {
    try {
      await serviceHub.models().startModel(provider, modelId)
    } catch (loadError) {
      throw new Error(
        `Failed to load model "${modelId}": ${extractErrorMessage(loadError)}`
      )
    }
  }
}
