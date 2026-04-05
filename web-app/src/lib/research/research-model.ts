import { useModelProvider } from '@/hooks/models/useModelProvider'
import { ModelFactory } from '@/lib/model-factory'

export async function buildResearchModel() {
  const { selectedModel, selectedProvider, providers } = useModelProvider.getState()
  const providerObj = providers.find((p) => p.provider === selectedProvider)
  if (!selectedModel || !providerObj) {
    throw new Error('No model selected. Please select a model in Settings → Models.')
  }
  // The proxy requires a base_url to forward requests to an upstream provider.
  // Local models (llamacpp) have no base_url and will 404 at the proxy.
  if (!providerObj.base_url) {
    throw new Error(
      `Deep Research requires a cloud model with a configured API endpoint. ` +
      `The selected model "${selectedModel.id}" has no remote endpoint configured. ` +
      `Please switch to a cloud model (e.g. GPT-4o, Claude, Gemini) in Settings → Models.`
    )
  }
  return ModelFactory.createModel(selectedModel.id, providerObj, {})
}
