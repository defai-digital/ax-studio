import { describe, expect, it, vi, beforeEach } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ core: () => ({ invoke: invokeMock }) }),
}))

import { syncRemoteProviders } from '../provider-sync'

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

  it('registers only active remote providers with api keys', async () => {
    await syncRemoteProviders([
      makeProvider('openai'),
      makeProvider('llamacpp'),
      makeProvider('anthropic', { active: false }),
      makeProvider('groq', { api_key: '' }),
    ])

    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      'register_provider_configs_batch',
      {
        requests: [
          {
            provider: 'openai',
            api_key: 'sk-test',
            base_url: 'https://openai.example.com/v1',
            custom_headers: [{ header: 'X-Test', value: '1' }],
            models: ['openai-model'],
          },
        ],
      }
    )
  })

  it('normalizes pasted bearer API keys before registering providers', async () => {
    await syncRemoteProviders([
      makeProvider('openrouter', { api_key: '  Bearer sk-or-test  ' }),
    ])

    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      'register_provider_configs_batch',
      {
        requests: [
          expect.objectContaining({
            provider: 'openrouter',
            api_key: 'sk-or-test',
          }),
        ],
      }
    )
  })

  it('invokes batch registration when remote providers are present', async () => {
    await syncRemoteProviders([makeProvider('openai')])

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'list_provider_configs')
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      'register_provider_configs_batch',
      {
        requests: [
          {
            provider: 'openai',
            api_key: 'sk-test',
            base_url: 'https://openai.example.com/v1',
            custom_headers: [{ header: 'X-Test', value: '1' }],
            models: ['openai-model'],
          },
        ],
      }
    )
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
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      'unregister_provider_config',
      {
        provider: 'anthropic',
      }
    )
    expect(invokeMock).toHaveBeenNthCalledWith(
      3,
      'unregister_provider_config',
      {
        provider: 'groq',
      }
    )
    expect(invokeMock).toHaveBeenNthCalledWith(
      4,
      'register_provider_configs_batch',
      {
        requests: [
          {
            provider: 'openai',
            api_key: 'sk-test',
            base_url: 'https://openai.example.com/v1',
            custom_headers: [{ header: 'X-Test', value: '1' }],
            models: ['openai-model'],
          },
        ],
      }
    )
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
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      'unregister_provider_config',
      {
        provider: 'anthropic',
      }
    )
    expect(invokeMock).toHaveBeenNthCalledWith(
      3,
      'unregister_provider_config',
      {
        provider: 'groq',
      }
    )
    expect(invokeMock).toHaveBeenCalledTimes(3)
  })

  it('does not unregister providers missing from a partial frontend list', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'list_provider_configs') {
        return [{ provider: 'openai' }, { provider: 'anthropic' }]
      }
      return undefined
    })

    await syncRemoteProviders([makeProvider('openai')])

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'list_provider_configs')
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      'register_provider_configs_batch',
      {
        requests: [
          {
            provider: 'openai',
            api_key: 'sk-test',
            base_url: 'https://openai.example.com/v1',
            custom_headers: [{ header: 'X-Test', value: '1' }],
            models: ['openai-model'],
          },
        ],
      }
    )
    expect(invokeMock).toHaveBeenCalledTimes(2)
  })

  it('unregisters missing remote providers for an authoritative list', async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'list_provider_configs') {
        return [{ provider: 'anthropic' }, { provider: 'llamacpp' }]
      }
      return undefined
    })

    await syncRemoteProviders([], { authoritative: true })

    expect(invokeMock).toHaveBeenNthCalledWith(2, 'unregister_provider_config', {
      provider: 'anthropic',
    })
    expect(invokeMock).toHaveBeenCalledTimes(2)
  })

  it('serializes overlapping snapshots in invocation order', async () => {
    let resolveFirstList!: (value: unknown[]) => void
    let listCalls = 0
    invokeMock.mockImplementation((command: string) => {
      if (command === 'list_provider_configs') {
        listCalls += 1
        if (listCalls === 1) {
          return new Promise((resolve) => {
            resolveFirstList = resolve
          })
        }
        return Promise.resolve([])
      }
      return Promise.resolve(undefined)
    })

    const first = syncRemoteProviders([makeProvider('openai')])
    await Promise.resolve()
    const second = syncRemoteProviders([makeProvider('anthropic')])
    await Promise.resolve()

    expect(listCalls).toBe(1)
    resolveFirstList([])
    await first
    await second

    const registrations = invokeMock.mock.calls.filter(
      ([command]) => command === 'register_provider_configs_batch'
    )
    expect(registrations).toHaveLength(2)
    expect(registrations[0][1].requests[0].provider).toBe('openai')
    expect(registrations[1][1].requests[0].provider).toBe('anthropic')
  })

  it('skips invoke when there are no remote providers at all', async () => {
    await syncRemoteProviders([makeProvider('llamacpp')])
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(invokeMock).toHaveBeenCalledWith('list_provider_configs')
  })
})
