import { localStorageKey } from '@/constants/localStorage'
import type { ModelInfo } from '@ax-studio/core'

export const getLastUsedModel = (): {
  provider: string
  model: string
} | null => {
  try {
    const stored = localStorage.getItem(localStorageKey.lastUsedModel)
    if (!stored) return null

    const parsed = JSON.parse(stored)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { provider?: unknown }).provider === 'string' &&
      typeof (parsed as { model?: unknown }).model === 'string'
    ) {
      return {
        provider: (parsed as { provider: string }).provider,
        model: (parsed as { model: string }).model,
      }
    }

    return null
  } catch (error) {
    console.debug('Failed to get last used model from localStorage:', error)
    return null
  }
}

// Helper function to determine which model to start
export const getModelToStart = (params: {
  selectedModel?: ModelInfo | null
  selectedProvider?: string | null
  getProviderByName: (name: string) => ModelProvider | undefined
}): { model: string; provider: ModelProvider } | null => {
  const { selectedModel, selectedProvider, getProviderByName } = params

  // Use last used model if available
  const lastUsedModel = getLastUsedModel()
  if (lastUsedModel) {
    const provider = getProviderByName(lastUsedModel.provider)
    if (provider && provider.models.some((m) => m.id === lastUsedModel.model)) {
      return { model: lastUsedModel.model, provider }
    }
  }

  // Use selected model if available
  if (selectedModel && selectedProvider) {
    const provider = getProviderByName(selectedProvider)
    if (provider) {
      return { model: selectedModel.id, provider }
    }
  }

  return null
}
