import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

/**
 * Creates a LanguageModel instance for the AI SDK based on the provider configuration.
 * This allows using Ax-Studio model providers with the AI SDK's useChat hook.
 *
 * Note: This function is synchronous and does not load the model or construct URLs.
 * URL construction should happen elsewhere after the model is ready.
 */
export function createLanguageModel(
  modelId: string,
  provider?: ModelProvider | null
): LanguageModel {
  if (!provider) {
    throw new Error('Provider configuration is required')
  }

  // For all providers, use the configured base_url and api_key
  const openAICompatible = createOpenAICompatible({
    name: provider.provider,
    apiKey: provider.api_key ?? '',
    baseURL: provider.base_url ?? 'http://localhost:1337/v1',
    headers: {
      // Add Origin header for local providers
      ...(provider.base_url?.includes('localhost:') ||
      provider.base_url?.includes('127.0.0.1:')
        ? { Origin: 'tauri://localhost' }
        : {}),
      // OpenRouter identification headers
      ...(provider.provider === 'openrouter'
        ? {
            'HTTP-Referer': 'https://axstudio.ai',
            'X-Title': 'Ax-Studio',
          }
        : {}),
    },
    // Include usage data in streaming responses for token speed calculation
    includeUsage: true,
  })

  return openAICompatible(modelId)
}
