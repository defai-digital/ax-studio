type ResolveSelectedModelOptions = {
  model?: ThreadModel
  providers: ModelProvider[]
  selectedProvider?: string
  selectedModelFromStore?: Model
}

export function resolveEffectiveSelectedModel({
  model,
  providers,
  selectedProvider,
  selectedModelFromStore,
}: ResolveSelectedModelOptions): Model | undefined {
  const providerList = Array.isArray(providers) ? providers : []

  if (model) {
    return (
      providerList
        .find((provider) => provider.provider === model.provider)
        ?.models?.find((providerModel) => providerModel.id === model.id) ??
      { id: model.id, provider: model.provider } as Model
    )
  }

  if (selectedProvider) {
    return (
      providerList
        .find((provider) => provider.provider === selectedProvider)
        ?.models?.find((providerModel) => providerModel.id === selectedModelFromStore?.id) ??
      selectedModelFromStore
    )
  }

  return selectedModelFromStore
}
