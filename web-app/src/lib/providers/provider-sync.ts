import { getServiceHub } from '@/hooks/useServiceHub'
import { LOCAL_PROVIDER_IDS } from '@/constants/providers'
import { withTimeout } from '@/lib/utils/async'

const PROVIDER_SYNC_TIMEOUT_MS = 8_000

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
  const configs = await withTimeout(
    getServiceHub().core().invoke<RegisteredProviderConfigView[]>('list_provider_configs'),
    PROVIDER_SYNC_TIMEOUT_MS,
    `Listing provider configs timed out after ${PROVIDER_SYNC_TIMEOUT_MS}ms`
  ).catch((error) => {
    console.error('Failed to list provider configs:', error)
    return []
  })
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

  // Use allSettled so one failed unregister doesn't block the batch register
  if (staleRemoteProviderIds.length > 0) {
    const results = await Promise.allSettled(
      staleRemoteProviderIds.map((provider) =>
        withTimeout(
          getServiceHub().core().invoke('unregister_provider_config', { provider }),
          PROVIDER_SYNC_TIMEOUT_MS,
          `Unregistering provider "${provider}" timed out after ${PROVIDER_SYNC_TIMEOUT_MS}ms`
        )
      )
    )
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('Failed to unregister provider:', result.reason)
      }
    }
  }

  const requests = buildRemoteProviderRequests(providers)
  if (requests.length === 0) return
  await withTimeout(
    getServiceHub().core().invoke('register_provider_configs_batch', { requests }),
    PROVIDER_SYNC_TIMEOUT_MS,
    `Registering provider configs timed out after ${PROVIDER_SYNC_TIMEOUT_MS}ms`
  ).catch((error) => {
    console.error('Failed to batch-register providers:', error)
  })
}
