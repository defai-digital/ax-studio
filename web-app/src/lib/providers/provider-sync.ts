import { invoke } from '@tauri-apps/api/core'

type ProviderCustomHeader = { header: string; value: string }

export type RegisterProviderRequest = {
  provider: string
  api_key?: string
  base_url?: string
  custom_headers: ProviderCustomHeader[]
  models: string[]
}

const LOCAL_PROVIDER_IDS = new Set(['llamacpp', 'mlx', 'ollama'])

export function buildRemoteProviderRequests(
  providers: ModelProvider[]
): RegisterProviderRequest[] {
  return providers
    .filter((provider) => provider.active && provider.api_key)
    .filter((provider) => !LOCAL_PROVIDER_IDS.has(provider.provider))
    .map((provider) => ({
      provider: provider.provider,
      api_key: provider.api_key,
      base_url: provider.base_url,
      custom_headers: (provider.custom_header || []).map((header) => ({
        header: header.header,
        value: header.value,
      })),
      models: provider.models.map((model) => model.id),
    }))
}

export async function syncRemoteProviders(providers: ModelProvider[]): Promise<void> {
  const requests = buildRemoteProviderRequests(providers)
  if (requests.length === 0) return
  await invoke('register_provider_configs_batch', { requests })
}
