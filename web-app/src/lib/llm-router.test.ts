import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseRouterResponse, getAvailableModelsForRouter } from './llm-router'
import { buildRouterPrompt } from './llm-router-prompt'

// Mock useFavoriteModel
vi.mock('@/hooks/useFavoriteModel', () => ({
  useFavoriteModel: {
    getState: () => ({
      favoriteModels: [{ id: 'gpt-4o', name: 'GPT-4o' }],
    }),
  },
}))

// Mock predefinedProviders
vi.mock('@/constants/providers', () => ({
  predefinedProviders: [
    { provider: 'anthropic' },
    { provider: 'openai' },
    { provider: 'gemini' },
    { provider: 'deepseek' },
  ],
}))

// Mock useModelProvider
vi.mock('@/hooks/useModelProvider', () => ({
  useModelProvider: {
    getState: () => ({
      getProviderByName: () => undefined,
    }),
  },
}))

const sampleModels: AvailableModelForRouter[] = [
  { id: 'claude-sonnet-4-6', provider: 'anthropic', displayName: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4-6', provider: 'anthropic', displayName: 'Claude Opus 4.6' },
  { id: 'gpt-4o', provider: 'openai', displayName: 'GPT-4o' },
  { id: 'gpt-4o-mini', provider: 'openai', displayName: 'GPT-4o Mini' },
  { id: 'deepseek-chat', provider: 'deepseek', displayName: 'DeepSeek V3' },
  { id: 'gemini-2.5-pro', provider: 'gemini', displayName: 'Gemini 2.5 Pro' },
]

describe('parseRouterResponse', () => {
  it('parses valid JSON response with exact match', () => {
    const raw = '{"model": "claude-sonnet-4-6", "provider": "anthropic", "reason": "code generation"}'
    const result = parseRouterResponse(raw, sampleModels)
    expect(result).toEqual({
      modelId: 'claude-sonnet-4-6',
      providerId: 'anthropic',
      reason: 'code generation',
    })
  })

  it('returns null for "default" sentinel', () => {
    const raw = '{"model": "default", "provider": "default", "reason": "general task"}'
    expect(parseRouterResponse(raw, sampleModels)).toBeNull()
  })

  it('handles markdown code fences', () => {
    const raw = '```json\n{"model": "gpt-4o", "provider": "openai", "reason": "quick answer"}\n```'
    const result = parseRouterResponse(raw, sampleModels)
    expect(result).toEqual({
      modelId: 'gpt-4o',
      providerId: 'openai',
      reason: 'quick answer',
    })
  })

  it('handles case-insensitive match', () => {
    const raw = '{"model": "Claude-Sonnet-4-6", "provider": "Anthropic", "reason": "coding"}'
    const result = parseRouterResponse(raw, sampleModels)
    expect(result).toEqual({
      modelId: 'claude-sonnet-4-6',
      providerId: 'anthropic',
      reason: 'coding',
    })
  })

  it('matches by model ID only when provider differs', () => {
    const raw = '{"model": "deepseek-chat", "provider": "DeepSeek", "reason": "tech task"}'
    const result = parseRouterResponse(raw, sampleModels)
    expect(result).toEqual({
      modelId: 'deepseek-chat',
      providerId: 'deepseek',
      reason: 'tech task',
    })
  })

  it('fuzzy matches when model ID is a substring', () => {
    const raw = '{"model": "sonnet-4-6", "provider": "anthropic", "reason": "coding"}'
    const result = parseRouterResponse(raw, sampleModels)
    expect(result).toEqual({
      modelId: 'claude-sonnet-4-6',
      providerId: 'anthropic',
      reason: 'coding',
    })
  })

  it('returns null for invalid JSON', () => {
    expect(parseRouterResponse('not json at all', sampleModels)).toBeNull()
  })

  it('returns null for missing model field', () => {
    const raw = '{"provider": "openai", "reason": "test"}'
    expect(parseRouterResponse(raw, sampleModels)).toBeNull()
  })

  it('returns null when model is not in available list', () => {
    const raw = '{"model": "nonexistent-model", "provider": "unknown", "reason": "test"}'
    expect(parseRouterResponse(raw, sampleModels)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseRouterResponse('', sampleModels)).toBeNull()
  })

  it('rejects short fuzzy matches that could be ambiguous', () => {
    // "pro" is too short (< 4 chars) to fuzzy match
    const raw = '{"model": "pro", "provider": "gemini", "reason": "test"}'
    expect(parseRouterResponse(raw, sampleModels)).toBeNull()
  })

  it('rejects fuzzy matches with low ratio', () => {
    // "chat" is 4 chars but ratio with "deepseek-chat" is 4/13 = 0.31 < 0.5
    const raw = '{"model": "chat", "provider": "deepseek", "reason": "test"}'
    expect(parseRouterResponse(raw, sampleModels)).toBeNull()
  })

  it('provides default reason when reason is missing', () => {
    const raw = '{"model": "gpt-4o", "provider": "openai"}'
    const result = parseRouterResponse(raw, sampleModels)
    expect(result).toEqual({
      modelId: 'gpt-4o',
      providerId: 'openai',
      reason: 'routed',
    })
  })
})

describe('getAvailableModelsForRouter', () => {
  const mockProviders: ModelProvider[] = [
    {
      active: true,
      provider: 'anthropic',
      api_key: 'sk-test',
      models: [
        { id: 'claude-sonnet-4-6', name: 'Sonnet', displayName: 'Claude Sonnet 4.6' },
        { id: 'claude-haiku-4-5', name: 'Haiku', displayName: 'Claude Haiku 4.5' },
        { id: 'embed-model', name: 'Embed', embedding: true },
      ],
      settings: [],
    },
    {
      active: true,
      provider: 'openai',
      api_key: 'sk-test',
      models: [
        { id: 'gpt-4o', displayName: 'GPT-4o' },
        { id: 'gpt-4o-mini', displayName: 'GPT-4o Mini' },
      ],
      settings: [],
    },
    {
      active: false,
      provider: 'inactive',
      api_key: 'sk-test',
      models: [{ id: 'inactive-model' }],
      settings: [],
    },
  ]

  it('excludes embedding models', () => {
    const result = getAvailableModelsForRouter(mockProviders, 'router-model')
    expect(result.find((m) => m.id === 'embed-model')).toBeUndefined()
  })

  it('excludes inactive providers', () => {
    const result = getAvailableModelsForRouter(mockProviders, 'router-model')
    expect(result.find((m) => m.id === 'inactive-model')).toBeUndefined()
  })

  it('excludes the router model itself', () => {
    const result = getAvailableModelsForRouter(mockProviders, 'gpt-4o')
    expect(result.find((m) => m.id === 'gpt-4o')).toBeUndefined()
  })

  it('returns correct structure', () => {
    const result = getAvailableModelsForRouter(mockProviders, 'router-model')
    expect(result[0]).toHaveProperty('id')
    expect(result[0]).toHaveProperty('provider')
    expect(result[0]).toHaveProperty('displayName')
  })

  it('prioritizes favorites', () => {
    const result = getAvailableModelsForRouter(mockProviders, 'router-model')
    // gpt-4o is in favorites mock, should be first
    expect(result[0].id).toBe('gpt-4o')
  })

  it('caps at 30 models', () => {
    const manyModels: ModelProvider[] = [
      {
        active: true,
        provider: 'test',
        api_key: 'key',
        models: Array.from({ length: 50 }, (_, i) => ({
          id: `model-${i}`,
          name: `Model ${i}`,
        })),
        settings: [],
      },
    ]
    const result = getAvailableModelsForRouter(manyModels, 'router-model')
    expect(result.length).toBe(30)
  })
})

describe('buildRouterPrompt', () => {
  it('builds system and user prompts', () => {
    const { system, user } = buildRouterPrompt('Write a Python function', sampleModels)
    expect(system).toContain('LLM router')
    expect(system).toContain('JSON')
    expect(user).toContain('Available models:')
    expect(user).toContain('claude-sonnet-4-6 (anthropic)')
    expect(user).toContain('Write a Python function')
  })

  it('includes recent context when provided', () => {
    const { user } = buildRouterPrompt('Continue', sampleModels, 'user: Write code\nassistant: Here is...')
    expect(user).toContain('Recent conversation context')
    expect(user).toContain('Write code')
  })

  it('omits context section when not provided', () => {
    const { user } = buildRouterPrompt('Hello', sampleModels)
    expect(user).not.toContain('Recent conversation context')
  })

  it('lists all available models', () => {
    const { user } = buildRouterPrompt('test', sampleModels)
    for (const model of sampleModels) {
      expect(user).toContain(model.id)
      expect(user).toContain(model.provider)
    }
  })
})
