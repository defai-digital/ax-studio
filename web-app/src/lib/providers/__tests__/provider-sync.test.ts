import { describe, expect, it, vi, beforeEach } from 'vitest'
import { buildRemoteProviderRequests, syncRemoteProviders } from '../provider-sync'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

function makeProvider(
  provider: string,
  extra: Partial<ModelProvider> = {}
): ModelProvider {
  return {
    provider,
    active: true,
    persist: false,
    api_key: 'sk-test',
    base_url: `https://${provider}.example.com/v1`,
    custom_header: [{ header: 'X-Test', value: '1' }],
    settings: [],
    models: [{ id: `${provider}-model` } as Model],
    ...extra,
  } as ModelProvider
}

describe('provider-sync', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'list_provider_configs') {
        return []
      }
      return undefined
    })
  })

  it('builds requests only for active remote providers with api keys', () => {
    const requests = buildRemoteProviderRequests([
      makeProvider('openai'),
      makeProvider('llamacpp'),
      makeProvider('anthropic', { active: false }),
      makeProvider('groq', { api_key: '' }),
    ])

    expect(requests).toEqual([
      {
        provider: 'openai',
        api_key: 'sk-test',
        base_url: 'https://openai.example.com/v1',
        custom_headers: [{ header: 'X-Test', value: '1' }],
        models: ['openai-model'],
      },
    ])
  })

  it('invokes batch registration when remote providers are present', async () => {
    await syncRemoteProviders([makeProvider('openai')])

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'list_provider_configs')
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'register_provider_configs_batch', {
      requests: [
        {
          provider: 'openai',
          api_key: 'sk-test',
          base_url: 'https://openai.example.com/v1',
          custom_headers: [{ header: 'X-Test', value: '1' }],
          models: ['openai-model'],
        },
      ],
    })
  })

  it('unregisters inactive remote providers before registering active ones', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'list_provider_configs') {
        return [
          { provider: 'openai' },
          { provider: 'anthropic' },
          { provider: 'groq' },
        ]
      }
      return undefined
    })

    await syncRemoteProviders([
      makeProvider('openai'),
      makeProvider('anthropic', { active: false }),
      makeProvider('groq', { api_key: '' }),
      makeProvider('llamacpp'),
    ])

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'list_provider_configs')
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'unregister_provider_config', {
      provider: 'anthropic',
    })
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'unregister_provider_config', {
      provider: 'groq',
    })
    expect(invokeMock).toHaveBeenNthCalledWith(4, 'register_provider_configs_batch', {
      requests: [
        {
          provider: 'openai',
          api_key: 'sk-test',
          base_url: 'https://openai.example.com/v1',
          custom_headers: [{ header: 'X-Test', value: '1' }],
          models: ['openai-model'],
        },
      ],
    })
  })

  it('unregisters stale remote providers when there are no eligible active providers', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'list_provider_configs') {
        return [{ provider: 'anthropic' }, { provider: 'groq' }]
      }
      return undefined
    })

    await syncRemoteProviders([
      makeProvider('anthropic', { active: false }),
      makeProvider('groq', { api_key: '' }),
      makeProvider('llamacpp'),
    ])

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'list_provider_configs')
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'unregister_provider_config', {
      provider: 'anthropic',
    })
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'unregister_provider_config', {
      provider: 'groq',
    })
    expect(invokeMock).toHaveBeenCalledTimes(3)
  })

  it('unregisters remote providers that were removed from the frontend list', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'list_provider_configs') {
        return [{ provider: 'openai' }, { provider: 'anthropic' }]
      }
      return undefined
    })

    await syncRemoteProviders([makeProvider('openai')])

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'list_provider_configs')
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'unregister_provider_config', {
      provider: 'anthropic',
    })
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'register_provider_configs_batch', {
      requests: [
        {
          provider: 'openai',
          api_key: 'sk-test',
          base_url: 'https://openai.example.com/v1',
          custom_headers: [{ header: 'X-Test', value: '1' }],
          models: ['openai-model'],
        },
      ],
    })
  })

  it('skips invoke when there are no remote providers at all', async () => {
    await syncRemoteProviders([makeProvider('llamacpp')])
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith('list_provider_configs')
  })
})
