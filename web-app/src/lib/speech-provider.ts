import { ModelCapabilities } from '@/types/models'

const toModelId = (model: Model): string => model.id || model.model || ''

const hasCapability = (model: Model, capability: ModelCapabilities): boolean =>
  model.capabilities?.includes(capability) ?? false

export const getSpeechProviders = (providers: ModelProvider[]): ModelProvider[] =>
  providers.filter((provider) => Boolean(provider.base_url))

export const normalizeBaseUrl = (baseUrl?: string): string => {
  const cleaned = (baseUrl || '').replace(/\/+$/, '')
  return cleaned
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/completions$/i, '')
}

export const getSpeechEndpoints = (baseUrl?: string): string[] => {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) return []

  const endpoints = [`${normalized}/audio/speech`]
  if (!/\/v\d+$/i.test(normalized)) {
    endpoints.push(`${normalized}/v1/audio/speech`)
  }
  return Array.from(new Set(endpoints))
}

export const getTranscriptionEndpoints = (baseUrl?: string): string[] => {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) return []

  const endpoints = [`${normalized}/audio/transcriptions`]
  if (!/\/v\d+$/i.test(normalized)) {
    endpoints.push(`${normalized}/v1/audio/transcriptions`)
  }
  return Array.from(new Set(endpoints))
}

export const getResponsesEndpoints = (baseUrl?: string): string[] => {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) return []

  const endpoints = [`${normalized}/responses`]
  if (!/\/v\d+$/i.test(normalized)) {
    endpoints.push(`${normalized}/v1/responses`)
  }
  return Array.from(new Set(endpoints))
}

export const getChatCompletionsEndpoints = (baseUrl?: string): string[] => {
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) return []

  const endpoints = [`${normalized}/chat/completions`]
  if (!/\/v\d+$/i.test(normalized)) {
    endpoints.push(`${normalized}/v1/chat/completions`)
  }
  return Array.from(new Set(endpoints))
}

export const getAudioToTextModels = (provider?: ModelProvider): Model[] => {
  if (!provider) return []
  const capabilityModels = provider.models.filter((model) =>
    hasCapability(model, ModelCapabilities.AUDIO_TO_TEXT)
  )
  if (capabilityModels.length > 0) return capabilityModels

  return provider.models.filter((model) =>
    /(whisper|transcrib|audio-to-text|speech-to-text|stt)/i.test(toModelId(model))
  )
}

export const getTextToAudioModels = (provider?: ModelProvider): Model[] => {
  if (!provider) return []
  const capabilityModels = provider.models.filter(
    (model) =>
      hasCapability(model, ModelCapabilities.TEXT_TO_AUDIO) ||
      hasCapability(model, ModelCapabilities.AUDIO_GENERATION)
  )
  if (capabilityModels.length > 0) return capabilityModels

  return provider.models.filter((model) =>
    /(tts|speech|audio|text-to-speech)/i.test(toModelId(model))
  )
}

export const getProviderHeaders = (
  provider?: ModelProvider,
  json = false
): Record<string, string> => {
  const headers: Record<string, string> = {}
  if (json) {
    headers['Content-Type'] = 'application/json'
  }

  if (provider?.api_key) {
    headers.Authorization = `Bearer ${provider.api_key}`
    headers['x-api-key'] = provider.api_key
  }

  provider?.custom_header?.forEach((header) => {
    if (header?.header) {
      headers[header.header] = header.value
    }
  })

  return headers
}

export const getDefaultSpeechProvider = (
  providers: ModelProvider[],
  selectedProvider?: string
): ModelProvider | undefined => {
  const availableProviders = getSpeechProviders(providers)
  return (
    availableProviders.find((provider) => provider.provider === selectedProvider) ??
    availableProviders[0]
  )
}

export const getDefaultModelId = (
  provider: ModelProvider | undefined,
  type: 'stt' | 'tts'
): string => {
  if (!provider) return ''
  const models = type === 'stt' ? getAudioToTextModels(provider) : getTextToAudioModels(provider)
  return models[0]?.id || ''
}
