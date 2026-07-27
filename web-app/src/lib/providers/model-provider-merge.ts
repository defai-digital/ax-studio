/**
 * Pure merge logic for model providers.
 * No service hub or runtime dependencies — fully unit-testable.
 *
 * @param incomingProviders - Fresh providers from the backend/service
 * @param existingProviders - Current providers from the store
 * @param deletedModels - Model IDs that have been explicitly deleted
 * @param pathSep - Kept for call-site compatibility. Model ID prefix matching
 *   always uses `/` (HF-style), not the OS filesystem separator.
 */
import {
  AX_ENGINE_SIDECAR_DEFAULT_BASE_URL,
  isAxEngineProvider,
  LEGACY_BUNDLED_MLX_MODEL_IDS,
  LEGACY_MLX_BASE_URLS,
  LOCAL_PROVIDER_IDS,
  normalizeProviderId,
} from '@/constants/providers'

function normalizeBaseUrl(url: string | undefined): string {
  return (url ?? '').trim().replace(/\/+$/, '')
}

/**
 * Rewrite retired in-process / :19997 URLs to the managed sidecar default
 * (`http://127.0.0.1:31418/v1`). Never rewrite back to port-0.
 */
export function resolveAxEngineBaseUrl(
  providerName: string,
  existingUrl: string | undefined,
  incomingUrl: string | undefined
): string | undefined {
  const preferred = existingUrl || incomingUrl
  if (
    isAxEngineProvider(providerName) &&
    LEGACY_MLX_BASE_URLS.has(normalizeBaseUrl(preferred))
  ) {
    return AX_ENGINE_SIDECAR_DEFAULT_BASE_URL
  }
  return preferred
}

export function mergeProviders(
  incomingProviders: ModelProvider[],
  existingProviders: ModelProvider[],
  deletedModels: string[],
  _pathSep: string = '/'
): ModelProvider[] {
  const safeDeletedModels = Array.isArray(deletedModels) ? deletedModels : []

  const validExistingProviders = existingProviders.map((provider) => ({
    ...provider,
    models: filterValidModels(provider.models),
  }))

  const updatedProviders = incomingProviders.map((provider) => {
    const providerId = normalizeProviderId(provider.provider)
    const existingProvider = validExistingProviders.find(
      (x) => normalizeProviderId(x.provider) === providerId
    )
    const existingModels = filterLegacyBundledMlxModels(
      providerId,
      filterValidModels(existingProvider?.models ?? [])
    )

    const mergedModels = [
      ...(provider.models ?? []).filter(
        (e) =>
          isValidModel(e) &&
          !existingModels.some((m) => m.id === e.id) &&
          (LOCAL_PROVIDER_IDS.has(providerId) ||
            !safeDeletedModels.includes(e.id))
      ),
      ...existingModels,
    ]

    const updatedModels = provider.models?.map((model) => {
      // Model IDs use HF-style `/` separators (e.g. org:model:Q4 → org/model),
      // not the OS path separator. Always join with `/` so Windows keeps settings.
      const settings =
        existingModels.find(
          (m) => m.id.split(':').slice(0, 2).join('/') === model.id
        )?.settings || model.settings

      const existingModel = existingModels.find((m) => m.id === model.id)
      const mergedCapabilities = [
        ...(model.capabilities ?? []),
        ...(existingModel?.capabilities ?? []).filter(
          (cap) => !(model.capabilities ?? []).includes(cap)
        ),
      ]

      return {
        ...model,
        settings,
        capabilities:
          mergedCapabilities.length > 0 ? mergedCapabilities : undefined,
        displayName: existingModel?.displayName || model.displayName,
      }
    })

    const baseUrl = resolveAxEngineBaseUrl(
      providerId,
      existingProvider?.base_url,
      provider.base_url
    )
    const connectionMode = isAxEngineProvider(providerId)
      ? (existingProvider?.connection_mode ??
        provider.connection_mode ??
        'managed')
      : undefined

    return {
      ...provider,
      provider: providerId,
      models: provider.persist ? updatedModels : mergedModels,
      settings: provider.settings.map((setting) => {
        const existingSetting = provider.persist
          ? undefined
          : existingProvider?.settings?.find((x) => x.key === setting.key)
        const controllerProps = {
          ...setting.controller_props,
          ...(existingSetting?.controller_props ?? {}),
        } as Record<string, unknown>
        if (
          isAxEngineProvider(providerId) &&
          setting.key === 'base-url' &&
          LEGACY_MLX_BASE_URLS.has(
            normalizeBaseUrl(String(controllerProps.value ?? ''))
          )
        ) {
          controllerProps.value = AX_ENGINE_SIDECAR_DEFAULT_BASE_URL
          if (
            LEGACY_MLX_BASE_URLS.has(
              normalizeBaseUrl(String(controllerProps.placeholder ?? ''))
            )
          ) {
            controllerProps.placeholder = AX_ENGINE_SIDECAR_DEFAULT_BASE_URL
          }
        }
        return {
          ...setting,
          controller_props: controllerProps,
        }
      }),
      api_key:
        connectionMode === 'attach'
          ? ''
          : existingProvider?.api_key || provider.api_key,
      base_url: baseUrl,
      connection_mode: connectionMode,
      active: existingProvider ? existingProvider.active : true,
    }
  })

  return [
    ...updatedProviders,
    ...validExistingProviders
      .filter(
        (e) =>
          !updatedProviders.some(
            (p) => normalizeProviderId(p.provider) === normalizeProviderId(e.provider)
          )
      )
      .map((e) => ({ ...e, provider: normalizeProviderId(e.provider) })),
  ]
}

function isValidModel(e: { id?: string; model?: string }): boolean {
  return ('id' in e || 'model' in e) && typeof (e.id ?? e.model) === 'string'
}

function filterValidModels<T extends { id?: string; model?: string }>(
  models: T[]
): T[] {
  return models.filter(isValidModel)
}

function filterLegacyBundledMlxModels<
  T extends { id?: string; model?: string },
>(provider: string, models: T[]): T[] {
  if (!isAxEngineProvider(provider)) return models

  return models.filter(
    (model) => !LEGACY_BUNDLED_MLX_MODEL_IDS.has(model.id ?? model.model ?? '')
  )
}
