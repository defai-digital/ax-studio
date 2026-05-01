import { models } from 'token.js'
import { ModelCapabilities } from '@/types/models'

export const defaultModel = (provider?: string) => {
  if (!provider || !Object.keys(models).includes(provider)) {
    return models.openai.models[0]
  }
  return (
    models[provider as unknown as keyof typeof models]
      .models as unknown as string[]
  )[0]
}

/**
 * Determines model capabilities based on provider configuration from token.js
 * @param providerName - The provider name (e.g., 'openai', 'anthropic', 'openrouter')
 * @param modelId - The model ID to check capabilities for
 * @returns Array of model capabilities
 */
export const getModelCapabilities = (
  providerName: string,
  modelId: string
): string[] => {
  const providerConfig = models[providerName as unknown as keyof typeof models]

  const supportsToolCalls = Array.isArray(
    providerConfig?.supportsToolCalls as unknown
  )
    ? (providerConfig.supportsToolCalls as unknown as string[])
    : []

  const supportsImages = Array.isArray(
    providerConfig?.supportsImages as unknown
  )
    ? (providerConfig.supportsImages as unknown as string[])
    : []

  return [
    ModelCapabilities.COMPLETION,
    supportsToolCalls.includes(modelId) ? ModelCapabilities.TOOLS : undefined,
    supportsImages.includes(modelId) ? ModelCapabilities.VISION : undefined,
  ].filter(Boolean) as string[]
}

/**
 * This utility is to extract cortexso model description from README.md file
 * @returns
 */
export const extractDescription = (text?: string) => {
  if (!text) return text
  const normalizedText = text.replace(/^---\n([\s\S]*?)\n---\n/, '')
  const overviewPattern = /(?:##\s*Overview\s*\n)([\s\S]*?)(?=\n\s*##|$)/
  const matches = normalizedText?.match(overviewPattern)
  let extractedText =
    matches && matches[1]
      ? matches[1].trim()
      : normalizedText?.slice(0, 500).trim()

  extractedText = extractedText?.replace(/!\[.*?\]\(.*?\)/g, '')
  extractedText = extractedText?.replace(/<img[^>]*>/g, '')

  return extractedText
}

export const extractModelName = (model?: string) => {
  return model?.split('/')[1] ?? model
}

export function getModelContextLength(model?: { settings?: Record<string, { controller_props?: { value?: unknown } }> }): number | undefined {
  const raw =
    model?.settings?.ctx_len?.controller_props?.value ??
    model?.settings?.ctx_size?.controller_props?.value
  if (typeof raw === 'number') return raw > 0 ? raw : undefined
  if (typeof raw === 'string') {
    const parsed = parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }
  return undefined
}
