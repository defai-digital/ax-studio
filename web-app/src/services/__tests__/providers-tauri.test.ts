import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineManager } from '@ax-studio/core'
import { ExtensionManager } from '@/lib/extension'
import { TauriProvidersService } from '../providers/tauri'

const mocks = vi.hoisted(() => ({
  fetchNative: vi.fn(),
  fetchTauri: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: mocks.fetchTauri,
}))

function provider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    provider: 'openai',
    name: 'OpenAI',
    base_url: 'https://api.openai.test/v1',
    api_key: 'secret',
    active: true,
    persist: true,
    models: [],
    settings: [],
    ...overrides,
  } as ModelProvider
}

function response(body: unknown, overrides: Partial<Response> = {}) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: vi.fn().mockResolvedValue(body),
    ...overrides,
  } as unknown as Response
}

describe('TauriProvidersService', () => {
  let service: TauriProvidersService

  beforeEach(() => {
    service = new TauriProvidersService()
    vi.clearAllMocks()
    globalThis.fetch = mocks.fetchNative as typeof fetch
    EngineManager.instance().engines.clear()
    window.core.extensionManager = new ExtensionManager()
  })

  it('exposes the Tauri HTTP fetch implementation', () => {
    expect(service.fetch()).toBe(mocks.fetchTauri)
  })

  it('requires a base URL before fetching provider models', async () => {
    await expect(
      service.fetchModelsFromProvider(provider({ base_url: '' }))
    ).rejects.toThrow('Provider must have base_url configured')
  })

  it('fetches OpenAI-style model responses with safe headers', async () => {
    mocks.fetchTauri.mockResolvedValue(
      response({ data: [{ id: 'gpt-4.1' }, { id: 'gpt-4.1-mini' }] })
    )

    const result = await service.fetchModelsFromProvider(
      provider({
        base_url: 'http://localhost:11434/v1',
        custom_header: [
          { header: 'X-Team', value: 'studio' },
          { header: 'Authorization', value: 'blocked' },
          { header: 'Origin', value: 'blocked' },
          { header: 'Cookie', value: 'blocked' },
        ],
      })
    )

    expect(result).toEqual(['gpt-4.1', 'gpt-4.1-mini'])
    expect(mocks.fetchTauri).toHaveBeenCalledWith(
      'http://localhost:11434/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'tauri://localhost',
          Authorization: 'Bearer secret',
          'X-Team': 'studio',
        },
        signal: expect.any(AbortSignal),
      })
    )
  })

  it('trims base URL before fetching provider models', async () => {
    mocks.fetchNative.mockResolvedValue(
      response({
        object: 'list',
        data: [
          { id: 'glm-4.6', object: 'model' },
          { id: 'glm-4.7', object: 'model' },
        ],
      })
    )

    const result = await service.fetchModelsFromProvider(
      provider({
        provider: 'zai-coding',
        base_url: ' https://api.z.ai/api/coding/paas/v4/ ',
      })
    )

    expect(result).toEqual(['glm-4.6', 'glm-4.7'])
    expect(mocks.fetchNative).toHaveBeenCalledWith(
      'https://api.z.ai/api/coding/paas/v4/models',
      expect.objectContaining({
        method: 'GET',
      })
    )
  })

  it('fetches alternative model response shapes', async () => {
    mocks.fetchNative.mockResolvedValue(
      response({ models: ['llama3', { id: 'mistral' }] })
    )

    await expect(
      service.fetchModelsFromProvider(provider({ api_key: undefined }))
    ).resolves.toEqual(['llama3', 'mistral'])

    mocks.fetchNative.mockResolvedValue(response(['qwen', { id: 'phi' }]))

    await expect(service.fetchModelsFromProvider(provider())).resolves.toEqual([
      'qwen',
      'phi',
    ])
  })

  it('returns an empty list for unexpected model response payloads', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.fetchNative.mockResolvedValue(response({ items: [{ id: 'hidden' }] }))

    await expect(service.fetchModelsFromProvider(provider())).resolves.toEqual([])

    expect(warnSpy).toHaveBeenCalledWith(
      'Unexpected response format from provider API:',
      { items: [{ id: 'hidden' }] }
    )
    warnSpy.mockRestore()
  })

  it.each([
    [
      401,
      'Unauthorized',
      'Authentication failed: API key is required or invalid for openai',
    ],
    [
      403,
      'Forbidden',
      'Access forbidden: Check your API key permissions for openai',
    ],
    [
      404,
      'Not Found',
      'Models endpoint not found for openai. Check the base URL configuration.',
    ],
    [
      500,
      'Internal Server Error',
      'Failed to fetch models from openai: 500 Internal Server Error',
    ],
  ])('throws descriptive HTTP errors for status %s', async (status, statusText, message) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.fetchNative.mockResolvedValue(
      response({}, { ok: false, status, statusText })
    )

    await expect(service.fetchModelsFromProvider(provider())).rejects.toThrow(
      message
    )

    errorSpy.mockRestore()
  })

  it('includes provider error body for failed model responses', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.fetchNative.mockResolvedValue(
      response(
        {},
        {
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: vi.fn().mockResolvedValue(
            '{"error":{"code":"401","message":"token expired or incorrect"}}'
          ),
        } as Partial<Response>
      )
    )

    await expect(
      service.fetchModelsFromProvider(provider({ provider: 'zai-coding' }))
    ).rejects.toThrow('token expired or incorrect')

    errorSpy.mockRestore()
  })

  it('returns a connection-focused error when the Tauri fetch fails before a response', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.fetchNative.mockRejectedValue(new Error('fetch failed'))

    await expect(service.fetchModelsFromProvider(provider())).rejects.toThrow(
      'Cannot connect to openai at https://api.openai.test/v1. Please check that the service is running and accessible.'
    )

    errorSpy.mockRestore()
  })

  it('wraps unknown failures with provider context', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.fetchNative.mockRejectedValue(new Error('socket closed'))

    await expect(service.fetchModelsFromProvider(provider())).rejects.toThrow(
      'Unexpected error while fetching models from openai: socket closed'
    )

    errorSpy.mockRestore()
  })

  it('preserves non-Error Tauri failure details', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.fetchNative.mockRejectedValue({
      message: 'builder error: invalid URL contains whitespace',
    })

    await expect(service.fetchModelsFromProvider(provider())).rejects.toThrow(
      'Unexpected error while fetching models from openai: builder error: invalid URL contains whitespace'
    )

    errorSpy.mockRestore()
  })

  it('combines runtime engine providers with built-in providers', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const runtimeEngine = {
      provider: 'llamacpp',
      inferenceUrl: 'http://localhost:11434/v1/chat/completions',
      list: vi.fn().mockResolvedValue([
        {
          id: 'local-tool-model',
          name: 'Local Tool Model',
          description: 'local model',
          capabilities: [],
        },
        {
          id: 'embedding-model',
          name: 'Embedding Model',
          embedding: true,
          capabilities: ['tools'],
        },
        {
          id: 'probe-fails',
          name: 'Probe Fails',
          capabilities: [],
        },
      ]),
      getSettings: vi.fn().mockResolvedValue([
        {
          key: 'ctx_len',
          title: 'Context',
          description: 'Context length',
          controllerType: 'slider',
          controllerProps: { value: 4096 },
        },
      ]),
      isToolSupported: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('tool probe failed')),
    }
    EngineManager.instance().engines.set('llamacpp', runtimeEngine as never)

    const result = await service.getProviders()
    const runtimeProvider = result.find((p) => p.provider === 'llamacpp')

    expect(runtimeProvider).toEqual(
      expect.objectContaining({
        provider: 'llamacpp',
        active: true,
        persist: true,
        base_url: 'http://localhost:11434/v1',
      })
    )
    expect(runtimeProvider?.settings).toEqual([
      expect.objectContaining({
        key: 'ctx_len',
        controller_type: 'slider',
        controller_props: { value: 4096 },
      }),
    ])
    expect(runtimeProvider?.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'local-tool-model',
          provider: 'llamacpp',
          capabilities: expect.arrayContaining(['tools']),
        }),
        expect.objectContaining({
          id: 'embedding-model',
          embedding: true,
          capabilities: expect.arrayContaining(['tools', 'embeddings']),
        }),
        expect.objectContaining({
          id: 'probe-fails',
          capabilities: [],
        }),
      ])
    )
    expect(result.some((p) => p.provider === 'openai')).toBe(true)
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed tool support check (probe-fails) for provider "llamacpp":',
      'tool probe failed'
    )
    warnSpy.mockRestore()
  })

  it('skips a failing runtime engine without hiding built-in providers', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    EngineManager.instance().engines.set('broken', {
      list: vi.fn().mockRejectedValue(new Error('engine unavailable')),
    } as never)

    const result = await service.getProviders()

    expect(result.some((p) => p.provider === 'openai')).toBe(true)
    expect(result.some((p) => p.provider === 'broken')).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed listing models for provider "broken":',
      'engine unavailable'
    )
    warnSpy.mockRestore()
  })

  it('maps provider settings to extension-engine settings updates', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(ExtensionManager.getInstance(), 'getEngine').mockReturnValue({
      updateSettings,
    } as never)

    await service.updateSettings('llamacpp', [
      {
        key: 'ctx_len',
        title: 'Context',
        description: 'Context length',
        controller_type: 'slider',
        controller_props: { value: 8192, min: 1024 },
      },
      {
        key: 'temperature',
        title: 'Temperature',
        description: 'Sampling temperature',
        controller_type: 'input',
        controller_props: {},
      },
    ] as ProviderSetting[])

    expect(updateSettings).toHaveBeenCalledWith([
      expect.objectContaining({
        key: 'ctx_len',
        controllerType: 'slider',
        controllerProps: { value: 8192, min: 1024 },
      }),
      expect.objectContaining({
        key: 'temperature',
        controllerType: 'input',
        controllerProps: { value: '' },
      }),
    ])
  })
})
