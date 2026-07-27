import { describe, it, expect } from 'vitest'
import { mergeProviders } from '../model-provider-merge'

// Minimal test helpers
function makeProvider(
  name: string,
  models: Partial<Model>[] = [],
  extra: Partial<ModelProvider> = {}
): ModelProvider {
  return {
    provider: name,
    models: models.map(
      (m) => ({ id: `${name}-model`, capabilities: [], ...m }) as Model
    ),
    settings: [],
    api_key: '',
    base_url: '',
    active: true,
    persist: false,
    ...extra,
  } as unknown as ModelProvider
}

describe('mergeProviders', () => {
  it('returns incoming providers when no existing providers', () => {
    const incoming = [makeProvider('openai', [{ id: 'gpt-4' }])]
    const result = mergeProviders(incoming, [], [], '/')
    expect(result).toHaveLength(1)
    expect(result[0].provider).toBe('openai')
  })

  it('preserves api_key and base_url from existing provider', () => {
    const existing = [
      makeProvider('openai', [], {
        api_key: 'sk-existing',
        base_url: 'https://api.openai.com',
      }),
    ]
    const incoming = [
      makeProvider('openai', [{ id: 'gpt-4' }], { api_key: '', base_url: '' }),
    ]
    const result = mergeProviders(incoming, existing, [], '/')
    expect(result[0].api_key).toBe('sk-existing')
    expect(result[0].base_url).toBe('https://api.openai.com')
  })

  it('rewrites legacy :19997 ax-engine base_url to the sidecar default 31418/v1', () => {
    const existing = [
      makeProvider('ax-engine', [], {
        base_url: 'http://127.0.0.1:19997/v1',
        settings: [
          {
            key: 'base-url',
            controller_props: {
              value: 'http://127.0.0.1:19997/v1',
              placeholder: 'http://127.0.0.1:19997/v1',
            },
          },
        ],
      } as Partial<ModelProvider>),
    ]
    const incoming = [
      makeProvider('ax-engine', [], {
        base_url: 'http://127.0.0.1:31418/v1',
        settings: [
          {
            key: 'base-url',
            controller_props: {
              value: 'http://127.0.0.1:31418/v1',
              placeholder: 'http://127.0.0.1:31418/v1',
            },
          },
        ],
      } as Partial<ModelProvider>),
    ]
    const result = mergeProviders(incoming, existing, [], '/')
    expect(result[0].base_url).toBe('http://127.0.0.1:31418/v1')
    expect(result[0].base_url).not.toBe('http://127.0.0.1:0/v1')
    expect(result[0].settings?.[0]?.controller_props).toEqual(
      expect.objectContaining({
        value: 'http://127.0.0.1:31418/v1',
        placeholder: 'http://127.0.0.1:31418/v1',
      })
    )
  })

  it('rewrites retired port-0 placeholder to the sidecar default 31418/v1', () => {
    const existing = [
      makeProvider('ax-engine', [], {
        base_url: 'http://127.0.0.1:0/v1',
        settings: [
          {
            key: 'base-url',
            controller_props: {
              value: 'http://127.0.0.1:0/v1',
              placeholder: 'http://127.0.0.1:0/v1',
            },
          },
        ],
      } as Partial<ModelProvider>),
    ]
    const incoming = [
      makeProvider('ax-engine', [], {
        base_url: 'http://127.0.0.1:31418/v1',
        settings: [
          {
            key: 'base-url',
            controller_props: {
              value: 'http://127.0.0.1:31418/v1',
              placeholder: 'http://127.0.0.1:31418/v1',
            },
          },
        ],
      } as Partial<ModelProvider>),
    ]
    const result = mergeProviders(incoming, existing, [], '/')
    expect(result[0].base_url).toBe('http://127.0.0.1:31418/v1')
    expect(result[0].base_url).not.toMatch(/:0(\/|$)/)
    expect(result[0].settings?.[0]?.controller_props).toEqual(
      expect.objectContaining({
        value: 'http://127.0.0.1:31418/v1',
        placeholder: 'http://127.0.0.1:31418/v1',
      })
    )
  })

  it('does not rewrite a live sidecar base_url', () => {
    const existing = [
      makeProvider('ax-engine', [], {
        base_url: 'http://127.0.0.1:31418/v1',
      }),
    ]
    const incoming = [
      makeProvider('ax-engine', [], {
        base_url: 'http://127.0.0.1:31418/v1',
      }),
    ]
    const result = mergeProviders(incoming, existing, [], '/')
    expect(result[0].base_url).toBe('http://127.0.0.1:31418/v1')
  })

  it('preserves an explicit AX Engine attach mode across provider refreshes', () => {
    const existing = [
      makeProvider('ax-engine', [], {
        connection_mode: 'attach',
        base_url: 'http://127.0.0.1:32000/v1',
        api_key: '',
      }),
    ]
    const incoming = [
      makeProvider('ax-engine', [], {
        connection_mode: 'managed',
        base_url: 'http://127.0.0.1:31418/v1',
        api_key: 'local',
      }),
    ]

    const result = mergeProviders(incoming, existing, [], '/')

    expect(result[0]).toMatchObject({
      connection_mode: 'attach',
      base_url: 'http://127.0.0.1:32000/v1',
      api_key: '',
    })
  })

  it('excludes models in deletedModels from merged list', () => {
    const existing = [makeProvider('openai', [{ id: 'gpt-3' }])]
    const incoming = [
      makeProvider('openai', [{ id: 'gpt-4' }, { id: 'gpt-3' }]),
    ]
    const result = mergeProviders(incoming, existing, ['gpt-4'], '/')
    const modelIds = result[0].models.map((m) => m.id)
    expect(modelIds).not.toContain('gpt-4')
    expect(modelIds).toContain('gpt-3')
  })

  it('keeps re-downloaded local models even when the id is in deletedModels', () => {
    const incoming = [
      makeProvider('llamacpp', [{ id: 'mlx-community/Qwen3.5-4B-4bit' }]),
    ]
    const result = mergeProviders(
      incoming,
      [],
      ['mlx-community/Qwen3.5-4B-4bit'],
      '/'
    )
    const modelIds = result[0].models.map((m) => m.id)
    expect(modelIds).toContain('mlx-community/Qwen3.5-4B-4bit')
  })

  it('matches colon-encoded model ids with HF slash paths even when pathSep is backslash', () => {
    const existingSettings = {
      temperature: {
        key: 'temperature',
        title: 'Temperature',
        description: '',
        controller_type: 'slider' as const,
        controller_props: { value: 0.2, min: 0, max: 2, step: 0.1 },
      },
    }
    const existing = [
      makeProvider('openrouter', [
        {
          id: 'org:model:Q4',
          settings: existingSettings,
        } as Partial<Model>,
      ]),
    ]
    const incoming = [
      makeProvider(
        'openrouter',
        [{ id: 'org/model' }],
        { persist: true }
      ),
    ]

    const withUnixSep = mergeProviders(incoming, existing, [], '/')
    const withWinSep = mergeProviders(incoming, existing, [], '\\')

    expect(withUnixSep[0].models[0].settings).toEqual(existingSettings)
    expect(withWinSep[0].models[0].settings).toEqual(existingSettings)
  })

  it('preserves providers in existing that are not in incoming', () => {
    const existing = [makeProvider('anthropic', [{ id: 'claude-3' }])]
    const incoming = [makeProvider('openai', [{ id: 'gpt-4' }])]
    const result = mergeProviders(incoming, existing, [], '/')
    const names = result.map((p) => p.provider)
    expect(names).toContain('openai')
    expect(names).toContain('anthropic')
  })

  it('uses pathSep when matching model settings by ID segments', () => {
    const existingModel = {
      id: 'llama:7b/path',
      settings: { key: 'value' },
    } as unknown as Model
    const existing = [makeProvider('llamacpp', [existingModel])]
    const incomingModel = { id: 'llama:7b' } as unknown as Model
    const incoming = [
      makeProvider('llamacpp', [incomingModel], { persist: true }),
    ]
    const result = mergeProviders(incoming, existing, [], '/')
    // With pathSep='/', 'llama:7b'.split(':').slice(0,2).join('/') = 'llama/7b' ≠ 'llama:7b/path'
    // No settings match expected — just verify it doesn't throw
    expect(result).toHaveLength(1)
  })

  it('treats deletedModels as empty array when undefined is passed', () => {
    const incoming = [makeProvider('openai', [{ id: 'gpt-4' }])]
    const result = mergeProviders(
      incoming,
      [],
      undefined as unknown as string[],
      '/'
    )
    expect(result[0].models.map((m) => m.id)).toContain('gpt-4')
  })

  it('merges capabilities from incoming and existing models', () => {
    const existingModel = {
      id: 'gpt-4',
      capabilities: ['vision'],
    } as unknown as Model
    const existing = [makeProvider('openai', [existingModel])]
    const incomingModel = {
      id: 'gpt-4',
      capabilities: ['tools'],
    } as unknown as Model
    const incoming = [
      makeProvider('openai', [incomingModel], { persist: true }),
    ]
    const result = mergeProviders(incoming, existing, [], '/')
    const caps = result[0].models[0].capabilities ?? []
    expect(caps).toContain('tools')
    expect(caps).toContain('vision')
  })

  it('preserves active=false from existing provider', () => {
    const existing = [makeProvider('openai', [], { active: false })]
    const incoming = [makeProvider('openai', [{ id: 'gpt-4' }])]
    const result = mergeProviders(incoming, existing, [], '/')
    expect(result[0].active).toBe(false)
  })

  it('removes legacy bundled MLX models from cached provider state', () => {
    const existing = [
      makeProvider('ax-engine', [
        { id: 'mlx-community/Qwen3.6-27B-4bit' },
        { id: 'user/imported-mlx-model' },
      ]),
    ]
    const incoming = [makeProvider('ax-engine', [])]
    const result = mergeProviders(incoming, existing, [], '/')
    const modelIds = result[0].models.map((model) => model.id)

    expect(modelIds).not.toContain('mlx-community/Qwen3.6-27B-4bit')
    expect(modelIds).toContain('user/imported-mlx-model')
  })
})
