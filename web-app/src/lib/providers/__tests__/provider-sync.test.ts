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
    invokeMock.mockResolvedValue(undefined)
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

    expect(invokeMock).toHaveBeenCalledWith('register_provider_configs_batch', {
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

  it('skips invoke when there are no eligible remote providers', async () => {
    await syncRemoteProviders([makeProvider('llamacpp')])
    expect(invokeMock).not.toHaveBeenCalled()
  })
})
