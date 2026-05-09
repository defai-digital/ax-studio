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
  if (model) {
    return (
      providers
        .find((provider) => provider.provider === model.provider)
        ?.models.find((providerModel) => providerModel.id === model.id) ??
      selectedModelFromStore
    )
  }

  if (selectedProvider) {
    return (
      providers
        .find((provider) => provider.provider === selectedProvider)
        ?.models.find((providerModel) => providerModel.id === selectedModelFromStore?.id) ??
      selectedModelFromStore
    )
  }

  return selectedModelFromStore
}
