import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getLastUsedModel, getModelToStart } from '../getModelToStart'

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
    get length() {
      return Object.keys(store).length
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  }
})()

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  writable: true,
})

function makeProvider(
  name: string,
  modelIds: string[],
  active = true
): ModelProvider {
  return {
    active,
    provider: name,
    settings: [],
    models: modelIds.map((id) => ({ id })),
  }
}

describe('getLastUsedModel', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  // ── A: Specification Tests ──

  it('returns null when no last used model is stored', () => {
    expect(getLastUsedModel()).toBe(null)
  })

  it('returns parsed model when valid JSON is stored', () => {
    localStorageMock.setItem(
      'last-used-model',
      JSON.stringify({ provider: 'openai', model: 'gpt-4' })
    )
    expect(getLastUsedModel()).toEqual({ provider: 'openai', model: 'gpt-4' })
  })

  it('returns null when stored value is invalid JSON', () => {
    localStorageMock.setItem('last-used-model', '{invalid json}')
    expect(getLastUsedModel()).toBe(null)
  })

  it('returns null when stored value is empty string', () => {
    localStorageMock.setItem('last-used-model', '')
    // Empty string is falsy, so `stored ? JSON.parse(stored) : null` returns null
    expect(getLastUsedModel()).toBe(null)
  })

  // ── B: Attack Tests ──

  it('handles stored value "null" string gracefully', () => {
    localStorageMock.setItem('last-used-model', 'null')
    expect(getLastUsedModel()).toBe(null)
  })

  it('handles stored value that is a JSON array', () => {
    localStorageMock.setItem('last-used-model', '["not", "an", "object"]')
    // JSON.parse succeeds, returns the array
    expect(getLastUsedModel()).toEqual(['not', 'an', 'object'])
  })

  // ── C: Property Tests ──

  it('never throws regardless of localStorage content', () => {
    const badValues = ['{bad', '42', 'true', '""', 'undefined']
    for (const val of badValues) {
      localStorageMock.setItem('last-used-model', val)
      expect(() => getLastUsedModel()).not.toThrow()
    }
  })
})

describe('getModelToStart', () => {
  beforeEach(() => {
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  const openaiProvider = makeProvider('openai', ['gpt-4', 'gpt-3.5-turbo'])
  const anthropicProvider = makeProvider('anthropic', ['claude-3-opus'])

  const getProviderByName = vi.fn((name: string) => {
    if (name === 'openai') return openaiProvider
    if (name === 'anthropic') return anthropicProvider
    return undefined
  })

  // ── A: Specification Tests ──

  describe('last used model path', () => {
    it('returns last used model when it exists in provider', () => {
      localStorageMock.setItem(
        'last-used-model',
        JSON.stringify({ provider: 'openai', model: 'gpt-4' })
      )
      const result = getModelToStart({
        selectedModel: { id: 'claude-3-opus' },
        selectedProvider: 'anthropic',
        getProviderByName,
      })
      expect(result).toEqual({ model: 'gpt-4', provider: openaiProvider })
    })

    it('skips last used model when provider is not found', () => {
      localStorageMock.setItem(
        'last-used-model',
        JSON.stringify({ provider: 'unknown-provider', model: 'some-model' })
      )
      const result = getModelToStart({
        selectedModel: { id: 'gpt-4' },
        selectedProvider: 'openai',
        getProviderByName,
      })
      expect(result).toEqual({ model: 'gpt-4', provider: openaiProvider })
    })

    it('skips last used model when model is not in provider models list', () => {
      localStorageMock.setItem(
        'last-used-model',
        JSON.stringify({ provider: 'openai', model: 'nonexistent-model' })
      )
      const result = getModelToStart({
        selectedModel: { id: 'claude-3-opus' },
        selectedProvider: 'anthropic',
        getProviderByName,
      })
      expect(result).toEqual({
        model: 'claude-3-opus',
        provider: anthropicProvider,
      })
    })
  })

  describe('selected model path', () => {
    it('returns selected model when no last used model exists', () => {
      const result = getModelToStart({
        selectedModel: { id: 'gpt-4' },
        selectedProvider: 'openai',
        getProviderByName,
      })
      expect(result).toEqual({ model: 'gpt-4', provider: openaiProvider })
    })

    it('returns null when selected provider is not found', () => {
      const result = getModelToStart({
        selectedModel: { id: 'some-model' },
        selectedProvider: 'unknown',
        getProviderByName,
      })
      expect(result).toBe(null)
    })

    it('returns null when selectedModel is null', () => {
      const result = getModelToStart({
        selectedModel: null,
        selectedProvider: 'openai',
        getProviderByName,
      })
      expect(result).toBe(null)
    })

    it('returns null when selectedProvider is null', () => {
      const result = getModelToStart({
        selectedModel: { id: 'gpt-4' },
        selectedProvider: null,
        getProviderByName,
      })
      expect(result).toBe(null)
    })

    it('returns null when both selectedModel and selectedProvider are undefined', () => {
      const result = getModelToStart({
        getProviderByName,
      })
      expect(result).toBe(null)
    })
  })

  // ── B: Attack Tests ──

  describe('adversarial scenarios', () => {
    it('last used model takes priority over selected model', () => {
      // DISCOVERED DESIGN ISSUE: lastUsedModel wins over explicit selection
      localStorageMock.setItem(
        'last-used-model',
        JSON.stringify({ provider: 'openai', model: 'gpt-4' })
      )
      const result = getModelToStart({
        selectedModel: { id: 'claude-3-opus' },
        selectedProvider: 'anthropic',
        getProviderByName,
      })
      // Last used model wins
      expect(result).toEqual({ model: 'gpt-4', provider: openaiProvider })
    })

    it('does NOT validate selectedModel exists in provider models (inconsistency with lastUsedModel path)', () => {
      // DISCOVERED BUG: selectedModel path does not check if model.id
      // is in provider.models, unlike the lastUsedModel path which does.
      const result = getModelToStart({
        selectedModel: { id: 'nonexistent-model-not-in-provider' },
        selectedProvider: 'openai',
        getProviderByName,
      })
      // This returns the model even though it doesn't exist in provider's models list
      expect(result).toEqual({
        model: 'nonexistent-model-not-in-provider',
        provider: openaiProvider,
      })
    })

    it('handles corrupted localStorage gracefully', () => {
      localStorageMock.setItem('last-used-model', '{corrupt')
      const result = getModelToStart({
        selectedModel: { id: 'gpt-4' },
        selectedProvider: 'openai',
        getProviderByName,
      })
      // Falls through to selected model since getLastUsedModel returns null on parse error
      expect(result).toEqual({ model: 'gpt-4', provider: openaiProvider })
    })
  })

  // ── C: Property Tests ──

  describe('properties', () => {
    it('return type is always { model: string, provider: ModelProvider } or null', () => {
      const result = getModelToStart({
        selectedModel: { id: 'gpt-4' },
        selectedProvider: 'openai',
        getProviderByName,
      })
      if (result !== null) {
        expect(typeof result.model).toBe('string')
        expect(result.provider).toHaveProperty('provider')
        expect(result.provider).toHaveProperty('models')
      }
    })

    it('never throws regardless of inputs', () => {
      expect(() =>
        getModelToStart({
          selectedModel: undefined,
          selectedProvider: undefined,
          getProviderByName: () => undefined,
        })
      ).not.toThrow()
    })

    it('is deterministic — same inputs yield same output', () => {
      const params = {
        selectedModel: { id: 'gpt-4' } as const,
        selectedProvider: 'openai',
        getProviderByName,
      }
      const result1 = getModelToStart(params)
      const result2 = getModelToStart(params)
      expect(result1).toEqual(result2)
    })
  })

  // ── D: Regression Tests ──
  // No past bug-fix commits found for this file beyond initial commit.
})
