import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CustomChatTransport } from '../custom-chat-transport'
import type { UIMessage } from '@ai-sdk/react'
import { ModelFactory } from '@/lib/model-factory'
import { routeMessage, getAvailableModelsForRouter } from '@/lib/llm-router'
import { executeSingleAgentStream } from '@/lib/transport/single-agent-transport'
import { prepareProviderForChat } from '@/lib/chat/model-session'
import { syncRemoteProviders } from '@/lib/providers/provider-sync'

// ─── Mock all Zustand stores the transport depends on ─────────────────────

const mocks = vi.hoisted(() => {
  const fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      text: () => Promise.resolve(''),
    } as Response)
  )
  globalThis.fetch = fetch as unknown as typeof globalThis.fetch

  const providers = [
    {
      provider: 'test-provider',
      models: [{ id: 'test-model', capabilities: [] }],
      settings: [],
    },
    {
      provider: 'routed-provider',
      models: [{ id: 'routed-model', capabilities: ['tools'] }],
      settings: [],
    },
    {
      provider: 'llamacpp',
      models: [
        { id: 'llama-3.2-3b-local.gguf', capabilities: [] },
        { id: 'gemma-4-26b-a4b-it-4bit', capabilities: [] },
      ],
      settings: [],
    },
  ]

  return {
    autoRouteEnabled: false,
    fetch,
    getProviderByName: vi.fn((providerId: string) =>
      providers.find((provider) => provider.provider === providerId)
    ),
    providers,
    routerModelId: null as string | null,
    routerProviderId: null as string | null,
    selectedModel: { id: 'test-model', capabilities: [] },
    selectedProvider: 'test-provider',
    timeout: 10000,
  }
})

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceStore: {
    getState: () => ({
      serviceHub: {
        mcp: () => ({ getTools: () => Promise.resolve([]) }),
        rag: () => ({ getTools: () => Promise.resolve([]) }),
      },
    }),
  },
  getServiceHub: () => ({
    mcp: () => ({ getTools: () => Promise.resolve([]) }),
    rag: () => ({ getTools: () => Promise.resolve([]) }),
  }),
}))

vi.mock('@/hooks/tools/useToolAvailable', () => ({
  useToolAvailable: {
    getState: () => ({
      getDisabledToolsForThread: () => [],
      getDefaultDisabledTools: () => [],
    }),
  },
}))

vi.mock('@/hooks/research/useLocalKnowledge', () => ({
  useLocalKnowledge: {
    getState: () => ({
      isLocalKnowledgeEnabledForThread: () => false,
      localKnowledgeEnabled: false,
    }),
  },
}))

vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: {
    getState: () => ({
      selectedModel: mocks.selectedModel,
      selectedProvider: mocks.selectedProvider,
      providers: mocks.providers,
      getProviderByName: mocks.getProviderByName,
    }),
  },
}))

vi.mock('@/hooks/chat/useAssistant', () => ({
  useAssistant: { getState: () => ({ currentAssistant: null }) },
}))

vi.mock('@/hooks/threads/useThreads', () => ({
  useThreads: {
    getState: () => ({
      getThreadById: () => null,
    }),
  },
}))

vi.mock('@/hooks/settings/useRouterSettings', () => ({
  useRouterSettings: {
    getState: () => ({
      isAutoRouteEnabled: () => mocks.autoRouteEnabled,
      routerModelId: mocks.routerModelId,
      routerProviderId: mocks.routerProviderId,
      timeout: mocks.timeout,
    }),
  },
}))

vi.mock('@/hooks/settings/useLocalApiServer', () => ({
  useLocalApiServer: {
    getState: () => ({
      serverHost: '127.0.0.1',
      serverPort: 1337,
      apiPrefix: '/v1',
      apiKey: '',
    }),
  },
}))

vi.mock('@/lib/file-registry', () => ({
  useFileRegistry: {
    getState: () => ({
      hasFiles: () => false,
    }),
  },
  threadCollectionId: () => 'thread-docs',
  projectCollectionId: () => 'project-docs',
}))

vi.mock('@/lib/llm-router', () => ({
  routeMessage: vi.fn(),
  getAvailableModelsForRouter: vi.fn(() => []),
}))

vi.mock('@/lib/transport/single-agent-transport', () => ({
  executeSingleAgentStream: vi.fn(() =>
    Promise.resolve(new ReadableStream({ start(c) { c.close() } }))
  ),
}))

vi.mock('@/lib/chat/model-session', () => ({
  prepareProviderForChat: vi.fn(() => Promise.resolve()),
  isLocalProvider: vi.fn((provider: ProviderObject) =>
    ['llamacpp', 'mlx', 'ollama'].includes(provider.provider)
  ),
}))

vi.mock('@/lib/providers/provider-sync', () => ({
  syncRemoteProviders: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/model-factory', () => ({
  ModelFactory: {
    createModel: vi.fn(() => Promise.resolve({})),
  },
}))

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeTransport(
  overrides: { systemMessage?: string; threadId?: string } = {}
) {
  return new CustomChatTransport(
    overrides.systemMessage,
    overrides.threadId,
    {},
    undefined
  )
}

// ─── Tests ────────────────────────────────────────────────────────────────

let consoleInfoSpy: ReturnType<typeof vi.spyOn>
let consoleWarnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  mocks.autoRouteEnabled = false
  mocks.routerModelId = null
  mocks.routerProviderId = null
  mocks.selectedModel = { id: 'test-model', capabilities: [] }
  mocks.selectedProvider = 'test-provider'
  mocks.timeout = 10000
  mocks.fetch.mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(''),
  } as Response)
  ;(routeMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
    modelId: 'test-model',
    providerId: 'test-provider',
    reason: 'fallback',
    routed: false,
    fallbackReason: 'disabled',
    latencyMs: 1,
  })
  ;(getAvailableModelsForRouter as ReturnType<typeof vi.fn>).mockReturnValue([
    {
      id: 'routed-model',
      provider: 'routed-provider',
      displayName: 'Routed Model',
    },
  ])
})

afterEach(() => {
  consoleInfoSpy.mockRestore()
  consoleWarnSpy.mockRestore()
})

describe('CustomChatTransport — construction', () => {
  it('stores system message and thread ID', () => {
    const transport = makeTransport({ systemMessage: 'Be helpful', threadId: 't1' })
    expect(transport).toBeDefined()
  })

  it('creates with defaults', () => {
    const transport = new CustomChatTransport()
    expect(transport).toBeDefined()
  })
})

describe('CustomChatTransport — updateSystemMessage', () => {
  it('updates the system message', () => {
    const transport = makeTransport()
    transport.updateSystemMessage('New system message')
    // The system message is private but we verify the transport doesn't throw
    expect(transport).toBeDefined()
  })
})

describe('CustomChatTransport — updateInferenceParameters', () => {
  it('updates inference parameters', () => {
    const transport = makeTransport()
    transport.updateInferenceParameters({ temperature: 0.7 })
    expect(transport).toBeDefined()
  })
})

describe('CustomChatTransport — updateModelOverrideId', () => {
  it('updates model override', () => {
    const transport = makeTransport()
    transport.updateModelOverrideId('custom-model')
    expect(transport).toBeDefined()
  })
})

describe('CustomChatTransport — setOnTokenUsage', () => {
  it('sets the callback', () => {
    const transport = makeTransport()
    const cb = vi.fn()
    transport.setOnTokenUsage(cb)
    expect(transport).toBeDefined()
  })
})

describe('CustomChatTransport — getTools', () => {
  it('returns empty tools initially', () => {
    const transport = makeTransport()
    expect(transport.getTools()).toEqual({})
  })
})

describe('CustomChatTransport — mapUserInlineAttachments', () => {
  it('passes through non-user messages unchanged', () => {
    const transport = makeTransport()
    const messages: UIMessage[] = [
      { id: '1', role: 'assistant', parts: [{ type: 'text', text: 'response' }] } as any,
    ]
    const result = transport.mapUserInlineAttachments(messages)
    expect(result).toEqual(messages)
  })

  it('passes through user messages without inline attachments unchanged', () => {
    const transport = makeTransport()
    const messages: UIMessage[] = [
      { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] } as any,
    ]
    const result = transport.mapUserInlineAttachments(messages)
    expect(result).toEqual(messages)
  })

  it('appends inline file contents to text parts', () => {
    const transport = makeTransport()
    const messages: UIMessage[] = [
      {
        id: '1',
        role: 'user',
        parts: [{ type: 'text', text: 'Explain this' }],
        metadata: {
          inline_file_contents: [
            { name: 'code.py', content: 'print("hello")' },
          ],
        },
      } as any,
    ]
    const result = transport.mapUserInlineAttachments(messages)
    const textPart = result[0].parts[0] as { type: string; text: string }
    expect(textPart.text).toContain('Explain this')
    expect(textPart.text).toContain('code.py')
    expect(textPart.text).toContain('print("hello")')
  })

  it('handles messages with no text part but inline attachments', () => {
    const transport = makeTransport()
    const messages: UIMessage[] = [
      {
        id: '1',
        role: 'user',
        parts: [{ type: 'text', text: '' }],
        metadata: {
          inline_file_contents: [
            { name: 'data.csv', content: 'a,b,c' },
          ],
        },
      } as any,
    ]
    const result = transport.mapUserInlineAttachments(messages)
    const textPart = result[0].parts[0] as { type: string; text: string }
    expect(textPart.text).toContain('data.csv')
    expect(textPart.text).toContain('a,b,c')
  })

  it('filters out attachments with no content', () => {
    const transport = makeTransport()
    const messages: UIMessage[] = [
      {
        id: '1',
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }],
        metadata: {
          inline_file_contents: [
            { name: 'empty.txt' },
            { name: 'valid.txt', content: 'data' },
          ],
        },
      } as any,
    ]
    const result = transport.mapUserInlineAttachments(messages)
    const textPart = result[0].parts[0] as { type: string; text: string }
    expect(textPart.text).toContain('valid.txt')
    expect(textPart.text).not.toContain('empty.txt')
  })
})

describe('CustomChatTransport — reconnectToStream', () => {
  it('returns null (reconnection not supported)', async () => {
    const transport = makeTransport()
    const result = await transport.reconnectToStream({ chatId: 'c1' } as any)
    expect(result).toBeNull()
  })
})

describe('CustomChatTransport — LLM Router integration', () => {
  it('routes messages through the configured router and streams with the routed model', async () => {
    mocks.autoRouteEnabled = true
    mocks.routerModelId = 'router-model'
    mocks.routerProviderId = 'test-provider'
    ;(routeMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      modelId: 'routed-model',
      providerId: 'routed-provider',
      reason: 'best model for coding',
      routed: true,
      latencyMs: 12,
    })
    const transport = makeTransport({ threadId: 'thread-1' })
    await transport.sendMessages({
      chatId: 'chat-1',
      messages: [
        {
          id: 'message-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Write a Rust parser' }],
        } as UIMessage,
      ],
      abortSignal: undefined,
      trigger: 'submit-message',
      messageId: 'message-1',
    })

    expect(getAvailableModelsForRouter).toHaveBeenCalledWith(
      mocks.providers,
      'router-model'
    )
    expect(syncRemoteProviders).toHaveBeenCalledWith(mocks.providers)
    expect(vi.mocked(syncRemoteProviders).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(routeMessage).mock.invocationCallOrder[0]
    )
    expect(routeMessage).toHaveBeenCalledWith(
      expect.any(Array),
      'router-model',
      'test-provider',
      [
        {
          id: 'routed-model',
          provider: 'routed-provider',
          displayName: 'Routed Model',
        },
      ],
      'test-model',
      'test-provider',
      10000
    )
    expect(ModelFactory.createModel).toHaveBeenCalledWith(
      'routed-model',
      expect.objectContaining({ provider: 'routed-provider' }),
      {},
      { requestRole: 'final' }
    )
    expect(executeSingleAgentStream).toHaveBeenCalledWith(
      expect.objectContaining({
        modelSupportsTools: true,
      })
    )
    expect(transport.lastRouterResult).toEqual(
      expect.objectContaining({
        modelId: 'routed-model',
        providerId: 'routed-provider',
        routed: true,
      })
    )
  })

  it('keeps using the selected model when router returns fallback', async () => {
    mocks.autoRouteEnabled = true
    mocks.routerModelId = 'router-model'
    mocks.routerProviderId = 'test-provider'
    ;(routeMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      modelId: 'test-model',
      providerId: 'test-provider',
      reason: 'fallback',
      routed: false,
      fallbackReason: 'could not parse router response',
      latencyMs: 8,
    })

    const transport = makeTransport({ threadId: 'thread-1' })
    await transport.sendMessages({
      chatId: 'chat-1',
      messages: [
        {
          id: 'message-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Hello' }],
        } as UIMessage,
      ],
      abortSignal: undefined,
      trigger: 'submit-message',
      messageId: 'message-1',
    })

    expect(routeMessage).toHaveBeenCalledTimes(1)
    expect(ModelFactory.createModel).toHaveBeenCalledWith(
      'test-model',
      expect.objectContaining({ provider: 'test-provider' }),
      {},
      { requestRole: 'final' }
    )
    expect(transport.lastRouterResult).toEqual(
      expect.objectContaining({
        modelId: 'test-model',
        providerId: 'test-provider',
        routed: false,
        fallbackReason: 'could not parse router response',
      })
    )
  })

  it('can route chat sends to a local model provider without an API key', async () => {
    mocks.autoRouteEnabled = true
    mocks.routerModelId = 'router-model'
    mocks.routerProviderId = 'test-provider'
    ;(routeMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
      modelId: 'llama-3.2-3b-local.gguf',
      providerId: 'llamacpp',
      reason: 'local model is sufficient',
      routed: true,
      latencyMs: 10,
    })

    const transport = makeTransport({ threadId: 'thread-1' })
    await transport.sendMessages({
      chatId: 'chat-1',
      messages: [
        {
          id: 'message-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Summarize this locally' }],
        } as UIMessage,
      ],
      abortSignal: undefined,
      trigger: 'submit-message',
      messageId: 'message-1',
    })

    expect(mocks.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:1337/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Ax-Provider': 'llamacpp',
          'X-Ax-Request-Role': 'preflight',
        }),
      })
    )
    expect(vi.mocked(prepareProviderForChat).mock.invocationCallOrder[0]).toBeLessThan(
      mocks.fetch.mock.invocationCallOrder[0]
    )
    expect(ModelFactory.createModel).toHaveBeenCalledWith(
      'llama-3.2-3b-local.gguf',
      expect.objectContaining({ provider: 'llamacpp' }),
      { max_output_tokens: 4096 },
      { requestRole: 'final' }
    )
    expect(transport.lastRouterResult).toEqual(
      expect.objectContaining({
        modelId: 'llama-3.2-3b-local.gguf',
        providerId: 'llamacpp',
        routed: true,
      })
    )
  })

  it('preflights a directly selected local model before final streaming', async () => {
    mocks.selectedModel = { id: 'gemma-4-26b-a4b-it-4bit', capabilities: [] }
    mocks.selectedProvider = 'llamacpp'

    const transport = makeTransport({ threadId: 'thread-1' })
    await transport.sendMessages({
      chatId: 'chat-1',
      messages: [
        {
          id: 'message-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Use the local model' }],
        } as UIMessage,
      ],
      abortSignal: undefined,
      trigger: 'submit-message',
      messageId: 'message-1',
    })

    expect(mocks.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:1337/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Ax-Provider': 'llamacpp',
          'X-Ax-Request-Role': 'preflight',
        }),
        body: expect.stringContaining('"stream":false'),
      })
    )
    expect(vi.mocked(prepareProviderForChat).mock.invocationCallOrder[0]).toBeLessThan(
      mocks.fetch.mock.invocationCallOrder[0]
    )
    expect(ModelFactory.createModel).toHaveBeenCalledWith(
      'gemma-4-26b-a4b-it-4bit',
      expect.objectContaining({ provider: 'llamacpp' }),
      { max_output_tokens: 4096 },
      { requestRole: 'final' }
    )
  })

  it('uses a minimal local provider when provider bootstrap is late', async () => {
    mocks.selectedModel = { id: 'bootstrap-late-local.gguf', capabilities: [] }
    mocks.selectedProvider = 'llamacpp'
    mocks.getProviderByName.mockImplementation((providerId: string) =>
      providerId === 'llamacpp'
        ? undefined
        : mocks.providers.find((provider) => provider.provider === providerId)
    )

    const transport = makeTransport({ threadId: 'thread-1' })
    await transport.sendMessages({
      chatId: 'chat-1',
      messages: [
        {
          id: 'message-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Use the local model' }],
        } as UIMessage,
      ],
      abortSignal: undefined,
      trigger: 'submit-message',
      messageId: 'message-1',
    })

    expect(prepareProviderForChat).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        provider: 'llamacpp',
        models: [expect.objectContaining({ id: 'bootstrap-late-local.gguf' })],
      }),
      'bootstrap-late-local.gguf'
    )
    expect(mocks.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:1337/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Ax-Provider': 'llamacpp',
          'X-Ax-Request-Role': 'preflight',
        }),
      })
    )
    expect(ModelFactory.createModel).toHaveBeenCalledWith(
      'bootstrap-late-local.gguf',
      expect.objectContaining({ provider: 'llamacpp' }),
      { max_output_tokens: 4096 },
      { requestRole: 'final' }
    )
  })
})
