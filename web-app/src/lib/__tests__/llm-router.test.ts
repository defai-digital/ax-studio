import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { UIMessage } from '@ai-sdk/react'
import { routeMessage, parseRouterResponse, getAvailableModelsForRouter } from '../llm-router'
import { buildRouterPrompt } from '../llm-router-prompt'

const routerMocks = vi.hoisted(() => ({
  createModel: vi.fn(),
  getProviderByName: vi.fn(),
  streamText: vi.fn(),
}))

// Mock useFavoriteModel
vi.mock('@/hooks/models/useFavoriteModel', () => ({
  useFavoriteModel: {
    getState: () => ({
      favoriteModels: [{ id: 'gpt-4o', name: 'GPT-4o' }],
    }),
  },
}))

// Mock predefinedProviders
vi.mock('@/constants/providers', () => ({
  LOCAL_PROVIDER_IDS: new Set(['llamacpp', 'mlx', 'ollama']),
  predefinedProviders: [
    { provider: 'anthropic' },
    { provider: 'openai' },
    { provider: 'gemini' },
    { provider: 'deepseek' },
  ],
}))

// Mock useModelProvider
vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: {
    getState: () => ({
      getProviderByName: routerMocks.getProviderByName,
    }),
  },
}))

vi.mock('../model-factory', () => ({
  ModelFactory: {
    createModel: routerMocks.createModel,
  },
}))

vi.mock('ai', () => ({
  streamText: routerMocks.streamText,
}))

const sampleModels: AvailableModelForRouter[] = [
  { id: 'claude-sonnet-4-6', provider: 'anthropic', displayName: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4-6', provider: 'anthropic', displayName: 'Claude Opus 4.6' },
  { id: 'gpt-4o', provider: 'openai', displayName: 'GPT-4o' },
  { id: 'gpt-4o-mini', provider: 'openai', displayName: 'GPT-4o Mini' },
  { id: 'deepseek-chat', provider: 'deepseek', displayName: 'DeepSeek V3' },
  { id: 'gemini-2.5-pro', provider: 'gemini', displayName: 'Gemini 2.5 Pro' },
]

const userMessage = (text: string): UIMessage => ({
  id: 'message-1',
  role: 'user',
  parts: [{ type: 'text', text }],
})

async function* streamParts(parts: Array<{ type: 'text-delta'; text: string }>) {
  for (const part of parts) {
    yield part
  }
}

beforeEach(() => {
  vi.useRealTimers()
  routerMocks.createModel.mockReset()
  routerMocks.getProviderByName.mockReset()
  routerMocks.streamText.mockReset()
  routerMocks.getProviderByName.mockReturnValue({
    provider: 'router-provider',
    models: [{ id: 'router-model' }],
    settings: [],
  })
  routerMocks.createModel.mockResolvedValue({ id: 'router-model-instance' })
})

afterEach(() => {
  vi.useRealTimers()
})

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

  it('rejects loose substring matches below the confidence threshold', () => {
    const raw = '{"model": "sonnet-4-6", "provider": "anthropic", "reason": "coding"}'
    const result = parseRouterResponse(raw, sampleModels)
    expect(result).toBeNull()
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

describe('routeMessage', () => {
  it('asks the router model and returns the chosen model when JSON is valid', async () => {
    routerMocks.streamText.mockReturnValue({
      fullStream: streamParts([
        {
          type: 'text-delta',
          text: '{"model":"claude-sonnet-4-6","provider":"anthropic","reason":"code generation"}',
        },
      ]),
    })

    const result = await routeMessage(
      [userMessage('Write a Rust parser')],
      'router-model',
      'router-provider',
      sampleModels,
      'gpt-4o-mini',
      'openai',
      15000,
    )

    expect(routerMocks.createModel).toHaveBeenCalledWith(
      'router-model',
      expect.objectContaining({ provider: 'router-provider' }),
      {},
      { requestRole: 'router' },
    )
    expect(routerMocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            content: expect.stringContaining('Write a Rust parser'),
          }),
        ],
        maxOutputTokens: 1024,
        temperature: 0,
      }),
    )
    expect(result).toEqual(
      expect.objectContaining({
        modelId: 'claude-sonnet-4-6',
        providerId: 'anthropic',
        reason: 'code generation',
        routed: true,
      }),
    )
  })

  it('routes production engineering directly to a strong remote model when available', async () => {
    routerMocks.streamText.mockReturnValue({
      fullStream: streamParts([
        {
          type: 'text-delta',
          text: '{"model":"Qwen3_5-9B-IQ4_XS","provider":"llamacpp","reason":"local coding"}',
        },
      ]),
    })

    const result = await routeMessage(
      [userMessage('Write production TypeScript with tests and edge cases')],
      'glm-5.1',
      'zai-coding',
      [
        { id: 'glm-5.1', provider: 'zai-coding', displayName: 'GLM 5.1' },
        {
          id: 'Qwen3_5-9B-IQ4_XS',
          provider: 'llamacpp',
          displayName: 'Qwen3.5 9B Local',
        },
      ],
      'Qwen3_5-9B-IQ4_XS',
      'llamacpp',
      15000,
    )

    expect(result).toEqual(
      expect.objectContaining({
        modelId: 'glm-5.1',
        providerId: 'zai-coding',
        reason: 'production coding',
        routed: true,
      }),
    )
    expect(routerMocks.streamText).not.toHaveBeenCalled()
  })

  it('falls back to the selected model when the router times out', async () => {
    vi.useFakeTimers()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    routerMocks.streamText.mockImplementation(
      ({ abortSignal }: { abortSignal: AbortSignal }) => ({
        fullStream: (async function* () {
          await new Promise((_resolve, reject) => {
            abortSignal.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            )
          })
        })(),
      }),
    )

    try {
      const resultPromise = routeMessage(
        [userMessage('Tell me a fun fact')],
        'router-model',
        'router-provider',
        sampleModels,
        'gpt-4o-mini',
        'openai',
        500,
      )

      await vi.advanceTimersByTimeAsync(2000)
      const result = await resultPromise

      expect(result).toEqual(
        expect.objectContaining({
          modelId: 'gpt-4o-mini',
          providerId: 'openai',
          reason: 'fallback',
          routed: false,
          fallbackReason: 'router timed out',
        }),
      )
      expect(warnSpy).toHaveBeenCalledWith(
        '[LLM Router] generateText error:',
        expect.any(DOMException),
        '| extracted message:',
        'Aborted',
      )
    } finally {
      warnSpy.mockRestore()
    }
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

  it('keeps the router model eligible for final responses', () => {
    const result = getAvailableModelsForRouter(mockProviders, 'gpt-4o')
    expect(result.find((m) => m.id === 'gpt-4o')).toEqual({
      id: 'gpt-4o',
      provider: 'openai',
      displayName: 'GPT-4o',
    })
  })

  it('includes local providers with loaded models even when no API key is configured', () => {
    const providers: ModelProvider[] = [
      {
        active: true,
        provider: 'llamacpp',
        api_key: '',
        models: [
          {
            id: 'llama-3.2-3b-local.gguf',
            name: 'Llama 3.2 3B Local',
          },
        ],
        settings: [],
      },
      {
        active: true,
        provider: 'mlx',
        models: [
          {
            id: 'qwen2.5-coder-7b-mlx',
            displayName: 'Qwen Coder MLX',
          },
        ],
        settings: [],
      },
    ]

    const result = getAvailableModelsForRouter(providers, 'router-model')

    expect(result).toEqual([
      {
        id: 'llama-3.2-3b-local.gguf',
        provider: 'llamacpp',
        displayName: 'Llama 3.2 3B Local',
      },
      {
        id: 'qwen2.5-coder-7b-mlx',
        provider: 'mlx',
        displayName: 'Qwen Coder MLX',
      },
    ])
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

  it('tells the router to prefer strong models for production engineering', () => {
    const { system } = buildRouterPrompt('Write production TypeScript with tests', sampleModels)
    expect(system).toContain('production code')
    expect(system).toContain('TypeScript/JavaScript')
    expect(system).toContain('best practices')
    expect(system).toContain('edge cases')
    expect(system).toContain('Do not choose a local model for production software engineering')
  })

  it('adds routing traits to model entries', () => {
    const { user } = buildRouterPrompt('Production TypeScript prompt', [
      { id: 'glm-5.1', provider: 'zai-coding', displayName: 'GLM 5.1' },
      {
        id: 'Qwen3_5-9B-IQ4_XS',
        provider: 'llamacpp',
        displayName: 'Qwen3.5 9B Local',
      },
    ])

    expect(user).toContain('glm-5.1 (zai-coding)')
    expect(user).toContain('[remote, strong coding/reasoning]')
    expect(user).toContain('Qwen3_5-9B-IQ4_XS (llamacpp)')
    expect(user).toContain('[local/free')
  })
})
