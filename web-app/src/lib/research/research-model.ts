import { useModelProvider } from '@/hooks/useModelProvider'
import { ModelFactory } from '@/lib/model-factory'

export async function buildResearchModel() {
  const { selectedModel, selectedProvider, providers } = useModelProvider.getState()
  const providerObj = providers.find((p) => p.provider === selectedProvider)
  if (!selectedModel || !providerObj) {
    throw new Error('No model selected. Please select a model in Settings → Models.')
  }
  return ModelFactory.createModel(selectedModel.id, providerObj, {})
}
