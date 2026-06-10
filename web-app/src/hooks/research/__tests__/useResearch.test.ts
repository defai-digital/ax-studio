import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  openResearch: vi.fn(),
  updateResearch: vi.fn(),
  addMessage: vi.fn(),
  setChatSessionsState: vi.fn(),
  prepareProviderForChat: vi.fn(),
  isLocalProvider: vi.fn(),
  buildResearchModel: vi.fn(),
  exaSearch: vi.fn(),
  searchWikipedia: vi.fn(),
  scrapeWithTimeout: vi.fn(),
  parseExaResults: vi.fn(),
  parsePlan: vi.fn(),
  parseDrillDown: vi.fn(),
  resetExaGate: vi.fn(),
  getErrorMessage: vi.fn(),
}))

let panelState: any
let chatSessionState: any

vi.mock('ai', () => ({
  generateText: mocks.generateText,
  streamText: mocks.streamText,
}))

vi.mock('../useResearchPanel', () => ({
  useResearchPanel: {
    getState: () => ({
      openResearch: mocks.openResearch,
      updateResearch: mocks.updateResearch,
    }),
  },
}))

vi.mock('@/hooks/chat/useMessages', () => ({
  useMessages: {
    getState: () => ({
      addMessage: mocks.addMessage,
    }),
  },
}))

vi.mock('@/stores/chat-session-store', () => ({
  useChatSessions: {
    setState: mocks.setChatSessionsState,
  },
}))

vi.mock('@/lib/messages', () => ({
  convertThreadMessageToUIMessage: (message: any) => ({
    id: message.id,
    role: message.role,
    parts: [],
  }),
}))

vi.mock('@/lib/completion', () => ({
  newUserThreadContent: (threadId: string, value: string) => ({
    id: 'user-message',
    object: 'thread.message',
    thread_id: threadId,
    role: 'user',
    content: [{ type: 'text', text: { value, annotations: [] } }],
    status: 'completed',
  }),
  newAssistantThreadContent: (
    threadId: string,
    value: string,
    metadata: Record<string, unknown>,
  ) => ({
    id: 'assistant-message',
    object: 'thread.message',
    thread_id: threadId,
    role: 'assistant',
    content: [{ type: 'text', text: { value, annotations: [] } }],
    status: 'completed',
    metadata,
  }),
}))

vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: {
    getState: () => ({
      selectedModel: { id: 'model-1' },
      selectedProvider: 'provider-1',
      providers: [{ provider: 'provider-1' }],
    }),
  },
}))

vi.mock('@/lib/chat/model-session', () => ({
  isLocalProvider: mocks.isLocalProvider,
  prepareProviderForChat: mocks.prepareProviderForChat,
}))

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ models: () => ({}) }),
}))

vi.mock('@/lib/research/research-model', () => ({
  buildResearchModel: mocks.buildResearchModel,
}))

vi.mock('@/lib/research/research-search', () => ({
  exaSearch: mocks.exaSearch,
  searchWikipedia: mocks.searchWikipedia,
  normalizeUrl: (url: string) => url.replace(/\/$/, ''),
  isExaRateLimitMessage: (message: string) =>
    /429|rate limit|too many requests/i.test(message),
  isExaRateLimitError: (error: unknown) =>
    error instanceof Error && error.name === 'ExaRateLimitError',
  resetExaGate: mocks.resetExaGate,
  getErrorMessage: mocks.getErrorMessage,
}))

vi.mock('@/lib/research/research-parsers', () => ({
  parseExaResults: mocks.parseExaResults,
  parsePlan: mocks.parsePlan,
  parseDrillDown: mocks.parseDrillDown,
}))

vi.mock('@/lib/research/research-scraper', () => ({
  scrapeWithTimeout: mocks.scrapeWithTimeout,
}))

vi.mock('@/lib/prompts/research-prompts', () => ({
  PLANNER_PROMPT: vi.fn((query: string) => `plan:${query}`),
  SUMMARISE_PROMPT: vi.fn((query: string, text: string) => `summary:${query}:${text}`),
  DRILL_DOWN_PROMPT: vi.fn(() => 'drill'),
  WRITER_PROMPT: vi.fn(() => 'writer'),
}))

import {
  __researchTestUtils,
  cancelResearchForThread,
  useResearch,
} from '../useResearch'

const streamFrom = (chunks: string[]) => ({
  textStream: (async function* stream() {
    for (const chunk of chunks) yield chunk
  })(),
})

describe('useResearch rate-limit helpers', () => {
  it('detects 429 messages as Exa rate limits', () => {
    expect(
      __researchTestUtils.isExaRateLimitMessage(
        'HTTP status client error (429 Too Many Requests)',
      ),
    ).toBe(true)
  })

  it('detects generic rate-limit wording', () => {
    expect(
      __researchTestUtils.isExaRateLimitMessage('Exa rate limit exceeded'),
    ).toBe(true)
    expect(
      __researchTestUtils.isExaRateLimitMessage(
        'Too many requests from this client',
      ),
    ).toBe(true)
  })

  it('detects ExaRateLimitError by name', () => {
    const err = new Error('some error')
    err.name = 'ExaRateLimitError'
    expect(__researchTestUtils.isExaRateLimitError(err)).toBe(true)
  })

  it('does not classify unrelated errors as rate limits', () => {
    expect(
      __researchTestUtils.isExaRateLimitMessage(
        'network timeout while connecting',
      ),
    ).toBe(false)
    expect(
      __researchTestUtils.isExaRateLimitError(
        new Error('connection reset by peer'),
      ),
    ).toBe(false)
  })
})

describe('useResearch workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    panelState = {
      status: 'idle',
      steps: [],
      sources: [],
      reportMarkdown: '',
    }
    chatSessionState = {
      sessions: {
        'thread-1': {
          chat: {
            messages: [],
          },
        },
      },
    }

    mocks.openResearch.mockImplementation((_threadId, query, depth) => {
      panelState = {
        status: 'running',
        query,
        depth,
        steps: [],
        sources: [],
        reportMarkdown: '',
      }
    })
    mocks.updateResearch.mockImplementation((_threadId, updater) => {
      panelState = updater(panelState)
    })
    mocks.setChatSessionsState.mockImplementation((updater) => {
      chatSessionState = updater(chatSessionState)
    })
    mocks.prepareProviderForChat.mockResolvedValue(undefined)
    mocks.isLocalProvider.mockReturnValue(false)
    mocks.buildResearchModel.mockResolvedValue({ modelId: 'research-model' })
    mocks.parsePlan.mockReturnValue(['What is AX Studio?'])
    mocks.parseDrillDown.mockReturnValue([])
    mocks.parseExaResults.mockReturnValue({
      sources: [
        {
          title: 'AX Studio docs',
          url: 'https://example.com/docs',
          snippet: 'AX Studio overview',
          score: 0.9,
        },
      ],
      debugMsg: '1 result',
    })
    mocks.exaSearch.mockResolvedValue({ results: [] })
    mocks.scrapeWithTimeout.mockResolvedValue(
      'AX Studio helps run local and remote model workflows with tools.',
    )
    mocks.generateText.mockResolvedValue({ text: 'summary' })
    mocks.streamText.mockReturnValue(
      streamFrom(['## Executive Summary\nAX Studio is ready.']),
    )
    mocks.getErrorMessage.mockImplementation((error) =>
      error instanceof Error ? error.message : String(error),
    )
  })

  it('runs a standard research workflow and saves the final answer', async () => {
    const { result } = renderHook(() => useResearch('thread-1'))

    await result.current.startResearch('AX Studio stability', 2)

    expect(mocks.openResearch).toHaveBeenCalledWith(
      'thread-1',
      'AX Studio stability',
      2,
    )
    expect(mocks.prepareProviderForChat).toHaveBeenCalled()
    expect(mocks.exaSearch).toHaveBeenCalledWith(
      'What is AX Studio?',
      3,
      expect.any(AbortSignal),
    )
    expect(mocks.addMessage).toHaveBeenCalledTimes(2)
    expect(panelState.status).toBe('done')
    expect(panelState.sources).toHaveLength(1)
    expect(panelState.steps.at(-1)).toMatchObject({ type: 'done' })
    expect(chatSessionState.sessions['thread-1'].chat.messages).toHaveLength(2)
  })

  it('shows startup progress while a local model is still loading', async () => {
    vi.useFakeTimers()
    mocks.isLocalProvider.mockReturnValueOnce(true)
    mocks.prepareProviderForChat.mockReturnValueOnce(new Promise(() => {}))
    const { result } = renderHook(() => useResearch('thread-1'))

    const researchPromise = result.current.startResearch('slow local model', 2)

    expect(panelState.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'planning',
          message: 'Preparing research…',
        }),
        expect.objectContaining({
          type: 'planning',
          message: 'Preparing selected model…',
        }),
      ]),
    )

    await vi.advanceTimersByTimeAsync(2_000)
    await researchPromise

    expect(panelState.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'planning',
          message: 'Model is still loading; continuing through proxy…',
        }),
      ]),
    )
    expect(panelState.status).toBe('done')
    vi.useRealTimers()
  })

  it('falls back to the original query when planning returns no subquestions', async () => {
    mocks.parsePlan.mockReturnValueOnce([])
    const { result } = renderHook(() => useResearch('thread-1'))

    await result.current.startResearch('single query', 2)

    expect(mocks.exaSearch).toHaveBeenCalledWith(
      'single query',
      3,
      expect.any(AbortSignal),
    )
    expect(panelState.steps.some((step: any) =>
      step.query?.includes('Planning returned no sub-questions'),
    )).toBe(true)
  })

  it('marks research as error when model setup fails', async () => {
    mocks.buildResearchModel.mockRejectedValueOnce(new Error('model missing'))
    const { result } = renderHook(() => useResearch('thread-1'))

    await result.current.startResearch('failure path', 2)

    expect(panelState.status).toBe('error')
    expect(panelState.error).toBe('model missing')
    expect(panelState.steps.at(-1)).toMatchObject({
      type: 'error',
      message: 'model missing',
    })
  })

  it('cancels active research controllers from helper and hook APIs', async () => {
    let capturedSignal: AbortSignal | null = null
    mocks.generateText.mockImplementationOnce(async (_args) => {
      capturedSignal = _args.abortSignal
      cancelResearchForThread('thread-1')
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    })
    const { result } = renderHook(() => useResearch('thread-1'))

    await result.current.startResearch('cancel path', 2)
    result.current.cancelResearch()

    expect(capturedSignal?.aborted).toBe(true)
    expect(panelState.status).toBe('cancelled')
    expect(panelState.error).toBeUndefined()
  })
})
