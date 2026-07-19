import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ModelFactory } from '../model-factory'
import type { ProviderObject } from '@ax-studio/core'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
  createAxEngineMetadataExtractor,
  createMlxIpcFetch,
} from '../mlx-ipc-fetch'

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

vi.mock('../mlx-ipc-fetch', () => ({
  createMlxIpcFetch: vi.fn(() => vi.fn()),
  createAxEngineMetadataExtractor: vi.fn(() => ({
    extractMetadata: vi.fn(),
    createStreamExtractor: vi.fn(),
  })),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn(() => ({ type: 'anthropic' }))),
}))

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn(() => ({ type: 'google' }))),
}))

async function readPatchedSseData(
  data: string
): Promise<Record<string, unknown>> {
  const provider: ProviderObject = {
    provider: 'openai',
    api_key: 'test-api-key',
    base_url: 'https://api.openai.com/v1',
    models: [],
    settings: [],
    active: true,
  }

  await ModelFactory.createModel('gpt-4', provider)

  const createModelConfig = vi
    .mocked(createOpenAICompatible)
    .mock.calls.at(-1)?.[0]
  const patchedFetch = createModelConfig?.fetch
  expect(patchedFetch).toBeTypeOf('function')

  const response = await patchedFetch!(
    `data:text/event-stream;charset=utf-8,${encodeURIComponent(`data: ${data}\n\n`)}`
  )
  const body = await response.text()
  const line = body.split('\n').find((item) => item.startsWith('data:'))
  expect(line).toBeDefined()

  return JSON.parse(line!.replace(/^data:\s*/, '')) as Record<string, unknown>
}

describe('ModelFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('OpenAI-compatible streaming patch fetch', () => {
    it('normalizes non-string content and reasoning fields in streaming chunks', async () => {
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

      const output = await readPatchedSseData(input)

      const choice = (
        output.choices as Array<{ delta: Record<string, unknown> }>
      )[0]
      expect(choice.delta.content).toBe('Hello')
      expect(choice.delta.reasoning_content).toBeUndefined()
      expect(choice.delta.role).toBe('1')
    })

    it('normalizes tool call metadata for streaming chunks', async () => {
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

      const output = await readPatchedSseData(input)

      const choice = (
        output.choices as Array<{
          delta: { tool_calls: Array<Record<string, unknown>> }
          finish_reason: unknown
        }>
      )[0]
      expect(choice.delta.tool_calls[0]).toMatchObject({
        index: 0,
        id: '42',
        function: {
          name: '7',
          arguments: '{"city":"Surat"}',
        },
      })
      expect(choice.finish_reason).toBe('false')
    })

    it('leaves valid chunks unchanged', async () => {
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

      const output = await readPatchedSseData(input)

      const choice = (
        output.choices as Array<{
          delta: Record<string, unknown>
          finish_reason: unknown
        }>
      )[0]
      expect(choice.delta.content).toBe('hello')
      expect(choice.delta.reasoning_content).toBeUndefined()
      expect(choice.delta.role).toBe('assistant')
      expect(choice.finish_reason).toBe('stop')
    })

    it('uses reasoning text as visible content when a stream chunk has no content', async () => {
      const input = JSON.stringify({
        choices: [
          {
            delta: {
              reasoning_content: 'thinking-only text',
            },
            finish_reason: null,
          },
        ],
      })

      const output = await readPatchedSseData(input)

      const choice = (
        output.choices as Array<{ delta: Record<string, unknown> }>
      )[0]
      expect(choice.delta.content).toBe('thinking-only text')
      expect(choice.delta.reasoning_content).toBeUndefined()
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
        custom_header: [{ header: 'anthropic-version', value: '2023-06-01' }],
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

    it('routes mlx through the in-process AX Engine IPC fetch shim', async () => {
      const provider: ProviderObject = {
        provider: 'ax-engine',
        api_key: '',
        base_url: 'http://127.0.0.1:0/v1',
        models: [],
        settings: [],
        active: true,
      }

      await ModelFactory.createModel('mlx-community/Qwen3.6-27B-4bit', provider)

      expect(createMlxIpcFetch).toHaveBeenCalledTimes(1)
      expect(createAxEngineMetadataExtractor).toHaveBeenCalledTimes(1)
      expect(createOpenAICompatible).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'ax-engine',
          baseURL: expect.stringMatching(/^http:\/\/127\.0\.0\.1:/),
          headers: expect.objectContaining({
            'X-Ax-Provider': 'ax-engine',
          }),
          metadataExtractor: expect.any(Object),
        })
      )
      const openAICompatible = vi.mocked(createOpenAICompatible).mock.results[0]
        ?.value as { languageModel: ReturnType<typeof vi.fn> }
      expect(openAICompatible.languageModel).toHaveBeenCalledWith(
        'mlx-community/Qwen3.6-27B-4bit'
      )
    })

    it('preserves top_k for AX Engine so sampled MTP can use its exact route', async () => {
      const ipcFetch = vi.fn(async () => new Response('{}'))
      vi.mocked(createMlxIpcFetch).mockReturnValueOnce(
        ipcFetch as unknown as typeof fetch
      )
      const provider: ProviderObject = {
        provider: 'ax-engine',
        api_key: '',
        base_url: 'http://127.0.0.1:0/v1',
        models: [],
        settings: [],
        active: true,
      }

      await ModelFactory.createModel(
        'mlx-community/Qwen3.6-27B-MTP',
        provider,
        { temperature: 0.7, top_p: 0.8, top_k: 20 }
      )
      const config = vi.mocked(createOpenAICompatible).mock.calls.at(-1)?.[0]
      await config?.fetch?.('http://localhost/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'mlx-community/Qwen3.6-27B-MTP' }),
      })

      const forwardedBody = JSON.parse(
        (ipcFetch.mock.calls[0]?.[1] as RequestInit | undefined)?.body as string
      )
      expect(forwardedBody).toMatchObject({
        temperature: 0.7,
        top_p: 0.8,
        top_k: 20,
      })
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
        custom_header: [{ header: 'X-Custom-Header', value: 'custom-value' }],
      }

      const model = await ModelFactory.createModel('custom-model', provider)
      expect(model).toBeDefined()
      expect(model.type).toBe('openai-compatible')
    })

    it('tags proxy requests with the optional request role', async () => {
      const provider: ProviderObject = {
        provider: 'zai-coding',
        api_key: 'test-api-key',
        base_url: 'https://api.z.ai/api/coding/paas/v4',
        models: [],
        settings: [],
        active: true,
      }

      await ModelFactory.createModel(
        'glm-5.1',
        provider,
        {},
        { requestRole: 'router' }
      )

      expect(createOpenAICompatible).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Ax-Provider': 'zai-coding',
            'X-Ax-Request-Role': 'router',
          }),
        })
      )
    })
  })
})
