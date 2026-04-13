import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ModelFactory, normalizeOpenAICompatibleEventData } from '../model-factory'
import type { ProviderObject } from '@ax-studio/core'

// Mock the Tauri invoke function
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

// Mock the AI SDK providers
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn(() => ({
    languageModel: vi.fn(() => ({ type: 'openai-compatible' })),
  })),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn(() => ({ type: 'anthropic' }))),
}))

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn(() => ({ type: 'google' }))),
}))

describe('ModelFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('normalizeOpenAICompatibleEventData', () => {
    it('normalizes non-string content and reasoning fields in streaming chunks', () => {
      const input = JSON.stringify({
        choices: [
          {
            delta: {
              content: [
                { type: 'text', text: 'Hel' },
                { type: 'text', text: 'lo' },
              ],
              reasoning_content: [
                { type: 'reasoning', text: 'Think' },
                { type: 'reasoning', text: 'ing' },
              ],
              role: 1,
            },
          },
        ],
      })

      const output = JSON.parse(normalizeOpenAICompatibleEventData(input))

      expect(output.choices[0].delta.content).toBe('Hello')
      expect(output.choices[0].delta.reasoning_content).toBe('Thinking')
      expect(output.choices[0].delta.role).toBe('1')
    })

    it('normalizes tool call metadata for streaming chunks', () => {
      const input = JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  id: 42,
                  function: {
                    name: 7,
                    arguments: { city: 'Surat' },
                  },
                },
              ],
            },
            finish_reason: false,
          },
        ],
      })

      const output = JSON.parse(normalizeOpenAICompatibleEventData(input))

      expect(output.choices[0].delta.tool_calls[0]).toMatchObject({
        index: 0,
        id: '42',
        function: {
          name: '7',
          arguments: '{"city":"Surat"}',
        },
      })
      expect(output.choices[0].finish_reason).toBe('false')
    })

    it('leaves valid chunks unchanged', () => {
      const input = JSON.stringify({
        choices: [
          {
            delta: {
              content: 'hello',
              reasoning_content: 'thinking',
              role: 'assistant',
              tool_calls: [
                {
                  index: 0,
                  id: 'tool-1',
                  function: {
                    name: 'weather',
                    arguments: '{"city":"Surat"}',
                  },
                },
              ],
            },
            finish_reason: 'stop',
          },
        ],
      })

      expect(normalizeOpenAICompatibleEventData(input)).toBe(input)
    })
  })

  describe('createModel', () => {
    it('should create an Anthropic model for anthropic provider', async () => {
      const provider: ProviderObject = {
        provider: 'anthropic',
        api_key: 'test-api-key',
        base_url: 'https://api.anthropic.com/v1',
        models: [],
        settings: [],
        active: true,
        custom_header: [
          { header: 'anthropic-version', value: '2023-06-01' },
        ],
      }

      const model = await ModelFactory.createModel('claude-3-opus', provider)
      expect(model).toBeDefined()
      expect(model.type).toBe('openai-compatible')
    })

    it('should create a Google model for google provider', async () => {
      const provider: ProviderObject = {
        provider: 'google',
        api_key: 'test-api-key',
        base_url: 'https://generativelanguage.googleapis.com/v1',
        models: [],
        settings: [],
        active: true,
      }

      const model = await ModelFactory.createModel('gemini-pro', provider)
      expect(model).toBeDefined()
      expect(model.type).toBe('openai-compatible')
    })

    it('should create a Google model for gemini provider', async () => {
      const provider: ProviderObject = {
        provider: 'gemini',
        api_key: 'test-api-key',
        base_url: 'https://generativelanguage.googleapis.com/v1',
        models: [],
        settings: [],
        active: true,
      }

      const model = await ModelFactory.createModel('gemini-pro', provider)
      expect(model).toBeDefined()
      expect(model.type).toBe('openai-compatible')
    })

    it('should create an OpenAI-compatible model for openai provider', async () => {
      const provider: ProviderObject = {
        provider: 'openai',
        api_key: 'test-api-key',
        base_url: 'https://api.openai.com/v1',
        models: [],
        settings: [],
        active: true,
      }

      const model = await ModelFactory.createModel('gpt-4', provider)
      expect(model).toBeDefined()
    })

    it('should create an OpenAI-compatible model for groq provider', async () => {
      const provider: ProviderObject = {
        provider: 'groq',
        api_key: 'test-api-key',
        base_url: 'https://api.groq.com/openai/v1',
        models: [],
        settings: [],
        active: true,
      }

      const model = await ModelFactory.createModel('llama-3', provider)
      expect(model).toBeDefined()
      expect(model.type).toBe('openai-compatible')
    })

    it('should handle custom headers for OpenAI-compatible providers', async () => {
      const provider: ProviderObject = {
        provider: 'custom',
        api_key: 'test-api-key',
        base_url: 'https://custom.api.com/v1',
        models: [],
        settings: [],
        active: true,
        custom_header: [
          { header: 'X-Custom-Header', value: 'custom-value' },
        ],
      }

      const model = await ModelFactory.createModel('custom-model', provider)
      expect(model).toBeDefined()
      expect(model.type).toBe('openai-compatible')
    })
  })
})
