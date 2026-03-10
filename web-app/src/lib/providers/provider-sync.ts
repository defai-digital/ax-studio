import { invoke } from '@tauri-apps/api/core'

type ProviderCustomHeader = { header: string; value: string }

export type RegisterProviderRequest = {
  provider: string
  api_key?: string
  base_url?: string
  custom_headers: ProviderCustomHeader[]
  models: string[]
}

type RegisteredProviderConfigView = {
  provider: string
}

const LOCAL_PROVIDER_IDS = new Set(['llamacpp', 'mlx', 'ollama'])

function isRemoteProvider(provider: ModelProvider): boolean {
  return !LOCAL_PROVIDER_IDS.has(provider.provider)
}

function isActiveRemoteProvider(provider: ModelProvider): boolean {
  return isRemoteProvider(provider) && provider.active && Boolean(provider.api_key)
}

export function buildRemoteProviderRequests(
  providers: ModelProvider[]
): RegisterProviderRequest[] {
  return providers
    .filter(isActiveRemoteProvider)
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

async function listRegisteredProviderIds(): Promise<string[]> {
  const configs = await invoke<RegisteredProviderConfigView[]>('list_provider_configs')
  return configs.map((config) => config.provider)
}

export async function syncRemoteProviders(providers: ModelProvider[]): Promise<void> {
  const registeredProviderIds = await listRegisteredProviderIds()
  const activeRemoteProviderIds = new Set(
    providers.filter(isActiveRemoteProvider).map((provider) => provider.provider)
  )
  const knownRemoteProviderIds = new Set(
    providers.filter(isRemoteProvider).map((provider) => provider.provider)
  )
  const staleRemoteProviderIds = registeredProviderIds.filter((provider) => {
    if (LOCAL_PROVIDER_IDS.has(provider)) return false
    return !activeRemoteProviderIds.has(provider) || !knownRemoteProviderIds.has(provider)
  })

  if (staleRemoteProviderIds.length > 0) {
    await Promise.all(
      staleRemoteProviderIds.map((provider) =>
        invoke('unregister_provider_config', { provider })
      )
    )
  }

  const requests = buildRemoteProviderRequests(providers)
  if (requests.length === 0) return
  await invoke('register_provider_configs_batch', { requests })
}
