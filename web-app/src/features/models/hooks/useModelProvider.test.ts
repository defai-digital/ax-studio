import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useModelProvider } from './useModelProvider'

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
    expect(baseUrlSetting.controller_props.value).toBe('https://api.mistral.ai/v1')
    expect(baseUrlSetting.controller_props.placeholder).toBe('https://api.mistral.ai/v1')
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
    expect(baseUrlSetting.controller_props.value).toBe('https://api.mistral.ai/v1')
    expect(baseUrlSetting.controller_props.placeholder).toBe('https://api.mistral.ai/v1')
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

    expect(migratedState.providers[0].base_url).toBe('https://api.mistral.ai/v1')
    expect(migratedState.providers[1].base_url).toBe('https://api.openai.com/v1')
  })
})
