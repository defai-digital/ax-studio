/**
 * Pure merge logic for model providers.
 * No service hub or runtime dependencies — fully unit-testable.
 *
 * @param incomingProviders - Fresh providers from the backend/service
 * @param existingProviders - Current providers from the store
 * @param deletedModels - Model IDs that have been explicitly deleted
 * @param pathSep - Platform path separator (e.g. '/' or '\\'), used for
 *   matching model IDs that encode the separator. Pass `serviceHub.path().sep()`
 *   at the call site — never call the service hub inside a store action.
 */
export function mergeProviders(
  incomingProviders: ModelProvider[],
  existingProviders: ModelProvider[],
  deletedModels: string[],
  pathSep: string = '/'
): ModelProvider[] {
  const safeDeletedModels = Array.isArray(deletedModels) ? deletedModels : []

  const validExistingProviders = existingProviders.map((provider) => ({
    ...provider,
    models: filterValidModels(provider.models),
  }))

  const updatedProviders = incomingProviders.map((provider) => {
    const existingProvider = validExistingProviders.find(
      (x) => x.provider === provider.provider
    )
    const existingModels = filterValidModels(existingProvider?.models ?? [])

    const mergedModels = [
      ...(provider.models ?? []).filter(
        (e) =>
          isValidModel(e) &&
          !existingModels.some((m) => m.id === e.id) &&
          !safeDeletedModels.includes(e.id)
      ),
      ...existingModels,
    ]

    const updatedModels = provider.models?.map((model) => {
      const settings =
        existingModels.find(
          (m) =>
            m.id.split(':').slice(0, 2).join(pathSep) === model.id
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

    return {
      ...provider,
      models: provider.persist ? updatedModels : mergedModels,
      settings: provider.settings.map((setting) => {
        const existingSetting = provider.persist
          ? undefined
          : existingProvider?.settings?.find((x) => x.key === setting.key)
        return {
          ...setting,
          controller_props: {
            ...setting.controller_props,
            ...(existingSetting?.controller_props ?? {}),
          },
        }
      }),
      api_key: existingProvider?.api_key || provider.api_key,
      base_url: existingProvider?.base_url || provider.base_url,
      active: existingProvider ? existingProvider.active : true,
    }
  })

  return [
    ...updatedProviders,
    ...validExistingProviders.filter(
      (e) => !updatedProviders.some((p) => p.provider === e.provider)
    ),
  ]
}

function isValidModel(e: { id?: string; model?: string }): boolean {
  return (
    ('id' in e || 'model' in e) && typeof (e.id ?? e.model) === 'string'
  )
}

function filterValidModels<T extends { id?: string; model?: string }>(
  models: T[]
): T[] {
  return models.filter(isValidModel)
}
