import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useModelProvider } from '../useModelProvider'

// Mock getServiceHub
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: vi.fn(() => ({
    path: () => ({
      sep: () => '/',
    }),
  })),
}))

// Mock the localStorage key constants
vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    modelProvider: 'model-provider',
  },
}))

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(() => null),
}
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
})

describe('useModelProvider - displayName functionality', () => {
  beforeEach(() => {
    // Reset the mock implementations instead of clearing them
    localStorageMock.getItem.mockReturnValue(null)
    localStorageMock.setItem.mockClear()
    localStorageMock.removeItem.mockClear()
    localStorageMock.clear.mockClear()

    // Reset Zustand store to default state
    act(() => {
      useModelProvider.setState({
        providers: [],
        selectedProvider: '',
        selectedModel: null,
        deletedModels: [],
      })
    })
  })

  it('should handle models without displayName property', () => {
    const { result } = renderHook(() => useModelProvider())

    const provider = {
      provider: 'test-provider',
      active: true,
      models: [
        {
          id: 'test-model.gguf',
          capabilities: ['completion'],
        },
      ],
      settings: [],
    } as any

    // First add the provider, then update it (since updateProvider only updates existing providers)
    act(() => {
      result.current.addProvider(provider)
    })

    const updatedProvider = result.current.getProviderByName('test-provider')
    expect(updatedProvider?.models[0].displayName).toBeUndefined()
    expect(updatedProvider?.models[0].id).toBe('test-model.gguf')
  })

  it('should preserve displayName when merging providers in setProviders', () => {
    const { result } = renderHook(() => useModelProvider())

    // First, set up initial state with displayName via direct state manipulation
    // This simulates the scenario where a user has already customized a display name
    act(() => {
      useModelProvider.setState({
        providers: [
          {
            provider: 'test-provider',
            active: true,
            models: [
              {
                id: 'test-model.gguf',
                displayName: 'My Custom Model',
                capabilities: ['completion'],
              },
            ],
            settings: [],
          },
        ] as any,
        selectedProvider: '',
        selectedModel: null,
        deletedModels: [],
      })
    })

    // Now simulate setProviders with fresh data (like from server refresh)
    const freshProviders = [
      {
        provider: 'test-provider',
        active: true,
        persist: true,
        models: [
          {
            id: 'test-model.gguf',
            capabilities: ['completion'],
            // Note: no displayName in fresh data
          },
        ],
        settings: [],
      },
    ] as any

    act(() => {
      result.current.setProviders(freshProviders)
    })

    // The displayName should be preserved from existing state
    const provider = result.current.getProviderByName('test-provider')
    expect(provider?.models[0].displayName).toBe('My Custom Model')
  })

  it('does not publish a new state when refreshed providers are unchanged', () => {
    const provider = {
      provider: 'test-provider',
      active: true,
      models: [{ id: 'test-model', capabilities: ['completion'] }],
      settings: [],
    } as any
    useModelProvider.getState().setProviders([provider])
    const stateBefore = useModelProvider.getState()
    const listener = vi.fn()
    const unsubscribe = useModelProvider.subscribe(listener)

    useModelProvider.getState().setProviders([provider])

    expect(useModelProvider.getState()).toBe(stateBefore)
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('publishes provider and model metadata changes when identities are unchanged', () => {
    const initial = {
      provider: 'test-provider',
      active: true,
      persist: true,
      explore_models_url: 'https://old.example/models',
      models: [{ id: 'test-model', version: 1, capabilities: ['completion'] }],
      settings: [],
    } as any
    useModelProvider.getState().setProviders([initial])

    useModelProvider.getState().setProviders([
      {
        ...initial,
        explore_models_url: 'https://new.example/models',
        models: [
          { id: 'test-model', version: 2, capabilities: ['completion'] },
        ],
      },
    ])

    const provider = useModelProvider.getState().providers[0]
    expect(provider.explore_models_url).toBe('https://new.example/models')
    expect(provider.models[0].version).toBe(2)
  })

  it('refreshes selectedModel when setProviders replaces model metadata', () => {
    const { result } = renderHook(() => useModelProvider())

    act(() => {
      useModelProvider.setState({
        providers: [
          {
            provider: 'test-provider',
            active: true,
            models: [
              {
                id: 'vision-model',
                capabilities: ['completion'],
              },
            ],
            settings: [],
          },
        ] as any,
        selectedProvider: 'test-provider',
        selectedModel: {
          id: 'vision-model',
          capabilities: ['completion'],
        } as any,
        deletedModels: [],
      })
    })

    act(() => {
      result.current.setProviders([
        {
          provider: 'test-provider',
          active: true,
          persist: true,
          models: [
            {
              id: 'vision-model',
              capabilities: ['completion', 'vision'],
            },
          ],
          settings: [],
        },
      ] as any)
    })

    expect(result.current.selectedModel?.capabilities).toContain('vision')
  })

  it('clears selectedModel when the selected model is deleted', () => {
    const { result } = renderHook(() => useModelProvider())

    act(() => {
      useModelProvider.setState({
        providers: [
          {
            provider: 'test-provider',
            active: true,
            models: [
              {
                id: 'model-a',
                capabilities: ['completion'],
              },
            ],
            settings: [],
          },
        ] as any,
        selectedProvider: 'test-provider',
        selectedModel: {
          id: 'model-a',
          capabilities: ['completion'],
        } as any,
        deletedModels: [],
      })
    })

    act(() => {
      result.current.deleteModel('model-a')
    })

    expect(result.current.selectedProvider).toBe('test-provider')
    expect(result.current.selectedModel).toBeNull()
  })

  it('clears selected provider and model when the selected provider is deleted', () => {
    const { result } = renderHook(() => useModelProvider())

    act(() => {
      useModelProvider.setState({
        providers: [
          {
            provider: 'test-provider',
            active: true,
            models: [
              {
                id: 'model-a',
                capabilities: ['completion'],
              },
            ],
            settings: [],
          },
        ] as any,
        selectedProvider: 'test-provider',
        selectedModel: {
          id: 'model-a',
          capabilities: ['completion'],
        } as any,
        deletedModels: [],
      })
    })

    act(() => {
      result.current.deleteProvider('test-provider')
    })

    expect(result.current.selectedProvider).toBe('')
    expect(result.current.selectedModel).toBeNull()
  })

  it('should provide basic functionality without breaking existing behavior', () => {
    const { result } = renderHook(() => useModelProvider())

    // Test that basic provider operations work
    expect(result.current.providers).toEqual([])
    expect(result.current.selectedProvider).toBe('')
    expect(result.current.selectedModel).toBeNull()

    // Test addProvider functionality
    const provider = {
      provider: 'openai',
      active: true,
      models: [],
      settings: [],
    } as any

    act(() => {
      result.current.addProvider(provider)
    })

    expect(result.current.providers).toHaveLength(1)
    expect(result.current.getProviderByName('openai')).toBeDefined()
  })

  it('should ignore malformed runtime provider operations', () => {
    const { result } = renderHook(() => useModelProvider())

    act(() => {
      result.current.addProvider({ active: true, models: [], settings: [] } as never)
      result.current.updateProvider('', { active: false })
      result.current.selectModelProvider('', 'model-a')
      result.current.deleteProvider(null as never)
      result.current.deleteModel('')
    })

    expect(result.current.providers).toEqual([])
    expect(result.current.selectedProvider).toBe('')
    expect(result.current.selectedModel).toBeNull()
    expect(result.current.deletedModels).toEqual([])
  })

  it('should normalize runtime provider and model identifiers', () => {
    const { result } = renderHook(() => useModelProvider())

    act(() => {
      result.current.addProvider({
        provider: ' openai ',
        active: true,
        models: [{ id: ' gpt-4 ', capabilities: [' completion ', 'completion'] }],
        settings: [],
      } as never)
    })

    expect(result.current.providers).toEqual([
      {
        provider: 'openai',
        active: true,
        models: [{ id: 'gpt-4', capabilities: ['completion'] }],
        settings: [],
      },
    ])

    act(() => {
      result.current.selectModelProvider(' openai ', ' gpt-4 ')
    })

    expect(result.current.selectedProvider).toBe('openai')
    expect(result.current.selectedModel?.id).toBe('gpt-4')
  })

  it('should handle provider operations with models that have displayName', () => {
    const { result } = renderHook(() => useModelProvider())

    // Test that we can at least get and set providers with displayName models
    const providerWithDisplayName = {
      provider: 'test-provider',
      active: true,
      models: [
        {
          id: 'test-model.gguf',
          displayName: 'Custom Model Name',
          capabilities: ['completion'],
        },
      ],
      settings: [],
    } as any

    // Set the state directly (simulating what would happen in real usage)
    act(() => {
      useModelProvider.setState({
        providers: [providerWithDisplayName],
        selectedProvider: '',
        selectedModel: null,
        deletedModels: [],
      })
    })

    const provider = result.current.getProviderByName('test-provider')
    expect(provider?.models[0].displayName).toBe('Custom Model Name')
    expect(provider?.models[0].id).toBe('test-model.gguf')
  })
})

describe('useModelProvider migrations', () => {
  it('does not throw on malformed persisted migration input', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    expect(migrate).toBeDefined()

    expect(() => migrate!(undefined, 10)).not.toThrow()
    expect(() => migrate!({ providers: 'bad' }, 10)).not.toThrow()

    expect(migrate!(undefined, 10)).toEqual({
      providers: [],
      selectedProvider: '',
      selectedModel: null,
      deletedModels: [],
    })
  })

  it('sanitizes persisted merge data and preserves store actions', () => {
    const persistApi = (useModelProvider as any).persist
    const merge = persistApi?.getOptions().merge as
      | ((persisted: unknown, current: unknown) => any)
      | undefined
    const current = useModelProvider.getState()

    expect(merge).toBeDefined()

    const merged = merge!(
      {
        providers: [
          null,
          { active: true, models: [], settings: [] },
          {
            provider: ' openai ',
            active: 'yes',
            models: [
              null,
              { id: '', name: 'bad' },
              {
                id: ' gpt-4 ',
                provider: 'openai',
                name: 'GPT 4',
                capabilities: [' text ', 42, 'text'],
                embedding: true,
              },
              {
                model: 'gpt-4o-mini',
                displayName: 'Mini',
                settings: {
                  ['__proto__']: {
                    key: 'temperature',
                    title: 'Unsafe prototype key',
                    description: '',
                    controller_type: 'input',
                    controller_props: { value: 'unsafe' },
                  },
                  temperature: {
                    key: 'temperature',
                    title: 'Temperature',
                    description: 'Sampling temperature',
                    controller_type: 'slider',
                    controller_props: { value: 0.7 },
                  },
                },
              },
            ],
            settings: [
              {
                key: 'base-url',
                title: 42,
                controller_type: 'input',
                controller_props: {
                  value: 'https://api.openai.com/v1',
                  min: 0,
                  max: 10,
                  step: 0.5,
                  rows: 4,
                  options: [{ value: 'a', name: 'A' }, { bad: true }],
                },
              },
            ],
            custom_header: [
              { header: 'x-test', value: '1' },
              { header: '', value: 'bad' },
            ],
          },
        ],
        selectedProvider: ' openai ',
        selectedModel: { id: ' gpt-4 ' },
        deletedModels: [' gpt-old ', null, 'gpt-old'],
        addProvider: null,
      },
      current
    )

    expect(merged.providers).toEqual([
      {
        provider: 'openai',
        active: true,
        settings: [
          {
            key: 'base-url',
            title: 'base-url',
            description: '',
            controller_type: 'input',
            controller_props: {
              value: 'https://api.openai.com/v1',
              min: 0,
              max: 10,
              step: 0.5,
              rows: 4,
              options: [{ value: 'a', name: 'A' }],
            },
          },
        ],
        models: [
          {
            id: 'gpt-4',
            provider: 'openai',
            name: 'GPT 4',
            capabilities: ['text'],
            embedding: true,
          },
          {
            id: 'gpt-4o-mini',
            model: 'gpt-4o-mini',
            displayName: 'Mini',
            settings: {
              temperature: {
                key: 'temperature',
                title: 'Temperature',
                description: 'Sampling temperature',
                controller_type: 'slider',
                controller_props: { value: 0.7 },
              },
            },
          },
        ],
        custom_header: [{ header: 'x-test', value: '1' }],
      },
    ])
    expect(merged.selectedProvider).toBe('openai')
    expect(merged.selectedModel?.id).toBe('gpt-4')
    expect(merged.deletedModels).toEqual(['gpt-old'])
    expect(typeof merged.addProvider).toBe('function')
    expect(
      Object.getPrototypeOf(merged.providers[0].models[1].settings)
    ).toBe(Object.prototype)
  })

  it('caps persisted providers, models, and deleted model ids', () => {
    const persistApi = (useModelProvider as any).persist
    const merge = persistApi?.getOptions().merge as
      | ((persisted: unknown, current: unknown) => any)
      | undefined
    const current = useModelProvider.getState()

    const merged = merge!(
      {
        providers: Array.from({ length: 105 }, (_, providerIndex) => ({
          provider: `provider-${providerIndex}`,
          active: true,
          settings: [],
          models: Array.from({ length: 2005 }, (_, modelIndex) => ({
            id: `model-${providerIndex}-${modelIndex}`,
          })),
        })),
        selectedProvider: '',
        selectedModel: null,
        deletedModels: Array.from(
          { length: 2005 },
          (_, modelIndex) => `deleted-${modelIndex}`
        ),
      },
      current
    )

    expect(merged.providers).toHaveLength(100)
    expect(merged.providers[0].models).toHaveLength(2000)
    expect(merged.deletedModels).toHaveLength(2000)
  })

  it('migrates Mistral provider base URL to add /v1 suffix', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    expect(migrate).toBeDefined()

    const persistedState = {
      providers: [
        {
          provider: 'mistral',
          models: [],
          base_url: 'https://api.mistral.ai',
          settings: [
            {
              key: 'base-url',
              controller_props: {
                value: 'https://api.mistral.ai',
                placeholder: 'https://api.mistral.ai',
              },
            },
          ],
        },
      ],
      selectedProvider: 'mistral',
      selectedModel: null,
      deletedModels: [],
    }

    const migratedState = migrate!(persistedState, 8)
    const mistralProvider = migratedState.providers[0]
    const baseUrlSetting = mistralProvider.settings.find(
      (setting: any) => setting.key === 'base-url'
    )

    expect(mistralProvider.base_url).toBe('https://api.mistral.ai/v1')
    expect(baseUrlSetting.controller_props.value).toBe(
      'https://api.mistral.ai/v1'
    )
    expect(baseUrlSetting.controller_props.placeholder).toBe(
      'https://api.mistral.ai/v1'
    )
  })

  it('does not migrate Mistral provider base URL if already has /v1', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    expect(migrate).toBeDefined()

    const persistedState = {
      providers: [
        {
          provider: 'mistral',
          models: [],
          base_url: 'https://api.mistral.ai/v1',
          settings: [
            {
              key: 'base-url',
              controller_props: {
                value: 'https://api.mistral.ai/v1',
                placeholder: 'https://api.mistral.ai/v1',
              },
            },
          ],
        },
      ],
      selectedProvider: 'mistral',
      selectedModel: null,
      deletedModels: [],
    }

    const migratedState = migrate!(persistedState, 8)
    const mistralProvider = migratedState.providers[0]
    const baseUrlSetting = mistralProvider.settings.find(
      (setting: any) => setting.key === 'base-url'
    )

    expect(mistralProvider.base_url).toBe('https://api.mistral.ai/v1')
    expect(baseUrlSetting.controller_props.value).toBe(
      'https://api.mistral.ai/v1'
    )
    expect(baseUrlSetting.controller_props.placeholder).toBe(
      'https://api.mistral.ai/v1'
    )
  })

  it('does not affect other providers during Mistral migration', () => {
    const persistApi = (useModelProvider as any).persist
    const migrate = persistApi?.getOptions().migrate as
      | ((state: unknown, version: number) => any)
      | undefined

    expect(migrate).toBeDefined()

    const persistedState = {
      providers: [
        {
          provider: 'mistral',
          models: [],
          base_url: 'https://api.mistral.ai',
          settings: [],
        },
        {
          provider: 'openai',
          models: [],
          base_url: 'https://api.openai.com/v1',
          settings: [],
        },
      ],
      selectedProvider: 'mistral',
      selectedModel: null,
      deletedModels: [],
    }

    const migratedState = migrate!(persistedState, 8)

    expect(migratedState.providers[0].base_url).toBe(
      'https://api.mistral.ai/v1'
    )
    expect(migratedState.providers[1].base_url).toBe(
      'https://api.openai.com/v1'
    )
  })
})

describe('useModelProvider - ax-engine base URL persist migration', () => {
  beforeEach(() => {
    localStorageMock.getItem.mockReturnValue(null)
    localStorageMock.setItem.mockClear()
    act(() => {
      useModelProvider.setState({
        providers: [],
        selectedProvider: '',
        selectedModel: null,
        deletedModels: [],
      })
    })
  })

  it('rewrites legacy :19997 base_url to sidecar 31418/v1 via setProviders', () => {
    const { result } = renderHook(() => useModelProvider())

    act(() => {
      result.current.setProviders([
        {
          provider: 'ax-engine',
          active: true,
          api_key: 'sk-local-ax-engine',
          base_url: 'http://127.0.0.1:19997/v1',
          models: [],
          settings: [
            {
              key: 'base-url',
              controller_props: {
                value: 'http://127.0.0.1:19997/v1',
                placeholder: 'http://127.0.0.1:19997/v1',
              },
            },
          ],
        } as ModelProvider,
      ])
    })

    const provider = result.current.providers.find(
      (p) => p.provider === 'ax-engine'
    )
    expect(provider?.base_url).toBe('http://127.0.0.1:31418/v1')
    expect(provider?.base_url).not.toBe('http://127.0.0.1:0/v1')
    expect(provider?.api_key).toBe('local')
    expect(provider?.settings).toEqual([])
  })

  it('rewrites retired port-0 placeholder to sidecar 31418/v1 via setProviders', () => {
    const { result } = renderHook(() => useModelProvider())

    act(() => {
      result.current.setProviders([
        {
          provider: 'mlx',
          active: true,
          api_key: 'sk-local-mlx',
          base_url: 'http://127.0.0.1:0/v1',
          models: [],
          settings: [
            {
              key: 'base-url',
              controller_props: {
                value: 'http://127.0.0.1:0/v1',
                placeholder: 'http://127.0.0.1:0/v1',
              },
            },
          ],
        } as ModelProvider,
      ])
    })

    const provider = result.current.providers.find(
      (p) => p.provider === 'ax-engine'
    )
    expect(provider).toBeDefined()
    expect(provider?.base_url).toBe('http://127.0.0.1:31418/v1')
    expect(provider?.base_url).not.toMatch(/:0(\/|$)/)
    expect(provider?.api_key).toBe('local')
  })

  it('removes legacy plaintext settings for an attached AX Engine', () => {
    const { result } = renderHook(() => useModelProvider())

    act(() => {
      result.current.setProviders([
        {
          provider: 'ax-engine',
          connection_mode: 'attach',
          active: true,
          api_key: 'legacy-plaintext-secret',
          base_url: 'http://127.0.0.1:32000/v1',
          models: [],
          settings: [
            {
              key: 'api-key',
              controller_props: { value: 'legacy-plaintext-secret' },
            },
          ],
        } as ModelProvider,
      ])
    })

    const provider = result.current.providers.find(
      (item) => item.provider === 'ax-engine'
    )
    expect(provider).toMatchObject({
      connection_mode: 'attach',
      api_key: '',
      settings: [],
    })
  })
})
