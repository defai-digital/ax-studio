import { localStorageKey } from '@/constants/localStorage'
import { safeStorageSetItem } from '@/lib/storage/storage'
import type { ModelInfo } from '@ax-studio/core'

/**
 * Persist the last used model — the same mechanism the composer's model
 * dropdown uses. The new-chat home composer reads this via `getLastUsedModel`.
 */
export const setLastUsedModel = (provider: string, model: string) => {
  try {
    safeStorageSetItem(
      localStorage,
      localStorageKey.lastUsedModel,
      JSON.stringify({ provider, model }),
      'setLastUsedModel'
    )
  } catch (error) {
    console.debug('Failed to set last used model in localStorage:', error)
  }
}

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

  // Explicit UI selection wins when it still exists in the provider catalog.
  if (selectedModel && selectedProvider) {
    const provider = getProviderByName(selectedProvider)
    if (provider && provider.models.some((m) => m.id === selectedModel.id)) {
      return { model: selectedModel.id, provider }
    }
  }

  // Fall back to the last used model only when no valid selection is available.
  const lastUsedModel = getLastUsedModel()
  if (lastUsedModel) {
    const provider = getProviderByName(lastUsedModel.provider)
    if (provider && provider.models.some((m) => m.id === lastUsedModel.model)) {
      return { model: lastUsedModel.model, provider }
    }
  }

  return null
}
