import type { ServiceHub } from '@/services'
import { LOCAL_PROVIDER_IDS } from '@/constants/providers'
import { extractErrorMessage } from '@/lib/utils/error'

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
        `Failed to load model "${modelId}": ${extractErrorMessage(loadError)}`
      )
    }
  }
}
