import { describe, it, expect } from 'vitest'
import {
  getSpeechProviders,
  normalizeBaseUrl,
  getSpeechEndpoints,
  getTranscriptionEndpoints,
  getResponsesEndpoints,
  getChatCompletionsEndpoints,
  getAudioToTextModels,
  getTextToAudioModels,
  getProviderHeaders,
  getDefaultSpeechProvider,
  getDefaultModelId,
} from '../speech-provider'
import { ModelCapabilities } from '@/types/models'

// Helper to create a provider
function makeProvider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    active: true,
    provider: 'test-provider',
    base_url: 'https://api.example.com/v1',
    api_key: 'sk-test',
    settings: [],
    models: [],
    ...overrides,
  }
}

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'model-1',
    ...overrides,
  }
}

describe('getSpeechProviders', () => {
  it('filters providers that have a base_url', () => {
    const providers = [
      makeProvider({ provider: 'a', base_url: 'https://api.a.com' }),
      makeProvider({ provider: 'b', base_url: '' }),
      makeProvider({ provider: 'c', base_url: undefined }),
      makeProvider({ provider: 'd', base_url: 'https://api.d.com' }),
    ]
    const result = getSpeechProviders(providers)
    expect(result).toHaveLength(2)
    expect(result[0].provider).toBe('a')
    expect(result[1].provider).toBe('d')
  })

  it('returns empty array when no providers have base_url', () => {
    const providers = [makeProvider({ base_url: '' })]
    expect(getSpeechProviders(providers)).toEqual([])
  })
})

describe('normalizeBaseUrl', () => {
  it('strips trailing slashes', () => {
    expect(normalizeBaseUrl('https://api.com///')).toBe('https://api.com')
  })

  it('strips /chat/completions suffix', () => {
    expect(normalizeBaseUrl('https://api.com/v1/chat/completions')).toBe('https://api.com/v1')
  })

  it('strips /completions suffix', () => {
    expect(normalizeBaseUrl('https://api.com/v1/completions')).toBe('https://api.com/v1')
  })

  it('is case-insensitive when stripping suffixes', () => {
    expect(normalizeBaseUrl('https://api.com/v1/Chat/Completions')).toBe('https://api.com/v1')
  })

  it('returns empty string for undefined input', () => {
    expect(normalizeBaseUrl(undefined)).toBe('')
  })

  it('returns empty string for empty string input', () => {
    expect(normalizeBaseUrl('')).toBe('')
  })

  it('handles URL with only trailing slash', () => {
    expect(normalizeBaseUrl('https://api.com/')).toBe('https://api.com')
  })
})

describe('getSpeechEndpoints', () => {
  it('returns audio/speech endpoints', () => {
    const result = getSpeechEndpoints('https://api.com')
    expect(result).toContain('https://api.com/audio/speech')
    expect(result).toContain('https://api.com/v1/audio/speech')
  })

  it('does not duplicate v1 endpoint if URL already ends with /v1', () => {
    const result = getSpeechEndpoints('https://api.com/v1')
    expect(result).toEqual(['https://api.com/v1/audio/speech'])
  })

  it('returns empty array for empty input', () => {
    expect(getSpeechEndpoints('')).toEqual([])
    expect(getSpeechEndpoints(undefined)).toEqual([])
  })
})

describe('getTranscriptionEndpoints', () => {
  it('returns audio/transcriptions endpoints', () => {
    const result = getTranscriptionEndpoints('https://api.com')
    expect(result).toContain('https://api.com/audio/transcriptions')
    expect(result).toContain('https://api.com/v1/audio/transcriptions')
  })

  it('does not duplicate v1 endpoint if URL already ends with /v1', () => {
    const result = getTranscriptionEndpoints('https://api.com/v1')
    expect(result).toEqual(['https://api.com/v1/audio/transcriptions'])
  })

  it('returns empty array for empty input', () => {
    expect(getTranscriptionEndpoints('')).toEqual([])
  })
})

describe('getResponsesEndpoints', () => {
  it('returns responses endpoints', () => {
    const result = getResponsesEndpoints('https://api.com')
    expect(result).toContain('https://api.com/responses')
    expect(result).toContain('https://api.com/v1/responses')
  })

  it('does not duplicate for /v1 URLs', () => {
    const result = getResponsesEndpoints('https://api.com/v1')
    expect(result).toEqual(['https://api.com/v1/responses'])
  })
})

describe('getChatCompletionsEndpoints', () => {
  it('returns chat/completions endpoints', () => {
    const result = getChatCompletionsEndpoints('https://api.com')
    expect(result).toContain('https://api.com/chat/completions')
    expect(result).toContain('https://api.com/v1/chat/completions')
  })

  it('does not duplicate for /v1 URLs', () => {
    const result = getChatCompletionsEndpoints('https://api.com/v1')
    expect(result).toEqual(['https://api.com/v1/chat/completions'])
  })

  it('normalizes URL before constructing endpoints', () => {
    // URL with /chat/completions suffix gets stripped, then rebuilt
    const result = getChatCompletionsEndpoints('https://api.com/v1/chat/completions')
    expect(result).toEqual(['https://api.com/v1/chat/completions'])
  })
})

describe('getAudioToTextModels', () => {
  it('returns empty array for undefined provider', () => {
    expect(getAudioToTextModels(undefined)).toEqual([])
  })

  it('returns models with AUDIO_TO_TEXT capability', () => {
    const provider = makeProvider({
      models: [
        makeModel({ id: 'whisper-1', capabilities: [ModelCapabilities.AUDIO_TO_TEXT] }),
        makeModel({ id: 'gpt-4', capabilities: [ModelCapabilities.COMPLETION] }),
      ],
    })
    const result = getAudioToTextModels(provider)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('whisper-1')
  })

  it('falls back to pattern matching when no capability models exist', () => {
    const provider = makeProvider({
      models: [
        makeModel({ id: 'whisper-large-v3' }),
        makeModel({ id: 'gpt-4' }),
        makeModel({ id: 'transcribe-model' }),
      ],
    })
    const result = getAudioToTextModels(provider)
    expect(result).toHaveLength(2)
    expect(result.map((m) => m.id)).toContain('whisper-large-v3')
    expect(result.map((m) => m.id)).toContain('transcribe-model')
  })

  it('prefers capability-based results over pattern matching', () => {
    const provider = makeProvider({
      models: [
        makeModel({ id: 'custom-stt', capabilities: [ModelCapabilities.AUDIO_TO_TEXT] }),
        makeModel({ id: 'whisper-v3' }), // matches pattern but not capability
      ],
    })
    const result = getAudioToTextModels(provider)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('custom-stt')
  })
})

describe('getTextToAudioModels', () => {
  it('returns empty array for undefined provider', () => {
    expect(getTextToAudioModels(undefined)).toEqual([])
  })

  it('returns models with TEXT_TO_AUDIO capability', () => {
    const provider = makeProvider({
      models: [
        makeModel({ id: 'tts-1', capabilities: [ModelCapabilities.TEXT_TO_AUDIO] }),
        makeModel({ id: 'gpt-4' }),
      ],
    })
    const result = getTextToAudioModels(provider)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('tts-1')
  })

  it('also returns models with AUDIO_GENERATION capability', () => {
    const provider = makeProvider({
      models: [
        makeModel({ id: 'audio-gen', capabilities: [ModelCapabilities.AUDIO_GENERATION] }),
      ],
    })
    const result = getTextToAudioModels(provider)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('audio-gen')
  })

  it('falls back to pattern matching for tts/speech/audio models', () => {
    const provider = makeProvider({
      models: [
        makeModel({ id: 'tts-1-hd' }),
        makeModel({ id: 'gpt-4' }),
        makeModel({ id: 'text-to-speech-v2' }),
      ],
    })
    const result = getTextToAudioModels(provider)
    expect(result).toHaveLength(2)
    expect(result.map((m) => m.id)).toContain('tts-1-hd')
    expect(result.map((m) => m.id)).toContain('text-to-speech-v2')
  })
})

describe('getProviderHeaders', () => {
  it('returns empty object when no provider or json', () => {
    expect(getProviderHeaders(undefined, false)).toEqual({})
  })

  it('includes Content-Type when json is true', () => {
    const headers = getProviderHeaders(undefined, true)
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('includes Authorization and x-api-key for providers with api_key', () => {
    const provider = makeProvider({ api_key: 'my-key' })
    const headers = getProviderHeaders(provider)
    expect(headers.Authorization).toBe('Bearer my-key')
    expect(headers['x-api-key']).toBe('my-key')
  })

  it('does not include auth headers when api_key is empty', () => {
    const provider = makeProvider({ api_key: '' })
    const headers = getProviderHeaders(provider)
    expect(headers.Authorization).toBeUndefined()
    expect(headers['x-api-key']).toBeUndefined()
  })

  it('includes custom headers from provider', () => {
    const provider = makeProvider({
      custom_header: [
        { header: 'X-Custom', value: 'custom-value' },
        { header: 'X-Another', value: 'another-value' },
      ],
    })
    const headers = getProviderHeaders(provider)
    expect(headers['X-Custom']).toBe('custom-value')
    expect(headers['X-Another']).toBe('another-value')
  })

  it('skips custom headers with empty header key', () => {
    const provider = makeProvider({
      custom_header: [
        { header: '', value: 'ignored' },
        { header: 'X-Valid', value: 'kept' },
      ],
    })
    const headers = getProviderHeaders(provider)
    expect(headers['']).toBeUndefined()
    expect(headers['X-Valid']).toBe('kept')
  })
})

describe('getDefaultSpeechProvider', () => {
  it('returns the selected provider if it has a base_url', () => {
    const providers = [
      makeProvider({ provider: 'openai', base_url: 'https://api.openai.com/v1' }),
      makeProvider({ provider: 'eleven', base_url: 'https://api.eleven.com' }),
    ]
    const result = getDefaultSpeechProvider(providers, 'eleven')
    expect(result?.provider).toBe('eleven')
  })

  it('falls back to first provider with base_url if selected not found', () => {
    const providers = [
      makeProvider({ provider: 'openai', base_url: 'https://api.openai.com/v1' }),
    ]
    const result = getDefaultSpeechProvider(providers, 'nonexistent')
    expect(result?.provider).toBe('openai')
  })

  it('returns undefined when no providers have base_url', () => {
    const providers = [makeProvider({ base_url: '' })]
    const result = getDefaultSpeechProvider(providers)
    expect(result).toBeUndefined()
  })
})

describe('getDefaultModelId', () => {
  it('returns empty string for undefined provider', () => {
    expect(getDefaultModelId(undefined, 'stt')).toBe('')
    expect(getDefaultModelId(undefined, 'tts')).toBe('')
  })

  it('returns first STT model id', () => {
    const provider = makeProvider({
      models: [
        makeModel({ id: 'whisper-1', capabilities: [ModelCapabilities.AUDIO_TO_TEXT] }),
      ],
    })
    expect(getDefaultModelId(provider, 'stt')).toBe('whisper-1')
  })

  it('returns first TTS model id', () => {
    const provider = makeProvider({
      models: [
        makeModel({ id: 'tts-1', capabilities: [ModelCapabilities.TEXT_TO_AUDIO] }),
      ],
    })
    expect(getDefaultModelId(provider, 'tts')).toBe('tts-1')
  })

  it('returns empty string when no matching models exist', () => {
    const provider = makeProvider({
      models: [makeModel({ id: 'gpt-4', capabilities: [ModelCapabilities.COMPLETION] })],
    })
    expect(getDefaultModelId(provider, 'stt')).toBe('')
  })
})
