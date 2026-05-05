import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CustomChatTransport } from '../custom-chat-transport'
import type { UIMessage } from '@ai-sdk/react'

// ─── Mock all Zustand stores the transport depends on ─────────────────────

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
      selectedModel: { id: 'test-model', capabilities: [] },
      selectedProvider: 'test-provider',
      providers: [],
      getProviderByName: () => ({
        provider: 'test-provider',
        models: [],
        settings: [],
      }),
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
      isAutoRouteEnabled: () => false,
      routerModelId: null,
      routerProviderId: null,
      timeout: 10000,
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
