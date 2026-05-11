import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeSingleAgentStream } from '../single-agent-transport'
import { stripUnavailableToolParts } from '../transport-types'
import type { SingleAgentConfig } from '../single-agent-transport'
import type { UIMessage } from '@ai-sdk/react'

// ─── Mock ai module ───────────────────────────────────────────────────────

const mockStreamText = vi.hoisted(() => {
  const listeners: Record<string, (...args: unknown[]) => unknown> = {}

  let capturedStreamOptions: Record<string, unknown> = {}

  const result = {
    toUIMessageStream: vi.fn((opts?: Record<string, unknown>) => {
      if (opts) capturedStreamOptions = opts
      return new ReadableStream({
        start(controller) {
          controller.close()
        },
      })
    }),
  }

  return { result, listeners, getCapturedOptions: () => capturedStreamOptions }
})

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    streamText: vi.fn(() => mockStreamText.result),
  }
})

vi.mock('@/hooks/settings/useAppState', () => ({
  useAppState: {
    getState: () => ({
      setTokenSpeed: vi.fn(),
    }),
  },
}))

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<SingleAgentConfig> = {}): SingleAgentConfig {
  return {
    model: {} as any,
    tools: {},
    systemMessage: undefined,
    messages: [],
    abortSignal: undefined,
    modelSupportsTools: false,
    onTokenUsage: undefined,
    mapUserInlineAttachments: (msgs) => msgs,
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('executeSingleAgentStream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a ReadableStream', async () => {
    const stream = await executeSingleAgentStream(makeConfig())
    expect(stream).toBeInstanceOf(ReadableStream)
  })

  it('passes system message to streamText', async () => {
    const { streamText } = await import('ai')
    await executeSingleAgentStream(makeConfig({ systemMessage: 'You are helpful' }))

    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({ system: 'You are helpful' })
    )
  })

  it('passes abort signal to streamText', async () => {
    const { streamText } = await import('ai')
    const controller = new AbortController()
    await executeSingleAgentStream(makeConfig({ abortSignal: controller.signal }))

    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({ abortSignal: controller.signal })
    )
  })

  it('enables tools when model supports them and tools are provided', async () => {
    const { streamText } = await import('ai')
    const tools = { search: {} as any }
    await executeSingleAgentStream(
      makeConfig({ tools, modelSupportsTools: true })
    )

    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools,
        toolChoice: 'auto',
      })
    )
  })

  it('disables tools when model does not support them', async () => {
    const { streamText } = await import('ai')
    const tools = { search: {} as any }
    await executeSingleAgentStream(
      makeConfig({ tools, modelSupportsTools: false })
    )

    const call = (await import('ai')).streamText as ReturnType<typeof vi.fn>
    const args = call.mock.calls[0][0]
    expect(args.tools).toBeUndefined()
    expect(args.toolChoice).toBeUndefined()
  })

  it('disables tools when no tools are provided even if model supports them', async () => {
    const { streamText } = await import('ai')
    await executeSingleAgentStream(
      makeConfig({ tools: {}, modelSupportsTools: true })
    )

    const call = (await import('ai')).streamText as ReturnType<typeof vi.fn>
    const args = call.mock.calls[0][0]
    expect(args.tools).toBeUndefined()
  })

  it('messageMetadata returns undefined for non-finish parts', async () => {
    await executeSingleAgentStream(makeConfig())
    const opts = mockStreamText.getCapturedOptions() as Record<string, unknown>
    const messageMetadata = opts.messageMetadata as (p: { part: unknown }) => unknown

    const result = messageMetadata({ part: { type: 'text-delta', text: '' } })
    expect(result).toBeUndefined()
  })

  it('messageMetadata tracks text-delta and returns undefined until finish', async () => {
    await executeSingleAgentStream(makeConfig())
    const opts = mockStreamText.getCapturedOptions() as Record<string, unknown>
    const messageMetadata = opts.messageMetadata as (p: { part: unknown }) => unknown

    // text-delta should track chars, return undefined
    expect(messageMetadata({ part: { type: 'text-delta', text: 'hello' } })).toBeUndefined()
    // finish-step should update tokensPerSecond metadata, return undefined
    expect(messageMetadata({ part: { type: 'finish-step', providerMetadata: {} } })).toBeUndefined()
  })

  it('messageMetadata returns usage metadata on finish', async () => {
    await executeSingleAgentStream(makeConfig())
    const opts = mockStreamText.getCapturedOptions() as Record<string, unknown>
    const messageMetadata = opts.messageMetadata as (p: { part: unknown }) => unknown

    const result = messageMetadata({
      part: {
        type: 'finish',
        totalUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        finishReason: 'stop',
      },
    })
    expect(result).toMatchObject({
      usage: expect.objectContaining({ inputTokens: 10 }),
      tokenSpeed: expect.objectContaining({ tokenCount: 20 }),
    })
  })

  it('onError callback returns error message string', async () => {
    await executeSingleAgentStream(makeConfig())
    const opts = mockStreamText.getCapturedOptions() as Record<string, unknown>
    const onError = opts.onError as (e: unknown) => string

    const msg = onError(new Error('stream failed'))
    expect(typeof msg).toBe('string')
    expect(msg).toContain('stream failed')
  })

  it('onFinish callback calls onTokenUsage when usage is present', async () => {
    const onTokenUsage = vi.fn()
    await executeSingleAgentStream(makeConfig({ onTokenUsage }))
    const opts = mockStreamText.getCapturedOptions() as Record<string, unknown>
    const onFinish = opts.onFinish as (p: { responseMessage: unknown }) => void

    onFinish({
      responseMessage: {
        id: 'msg-1',
        metadata: {
          usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 },
        },
      },
    })

    expect(onTokenUsage).toHaveBeenCalledWith(
      { inputTokens: 5, outputTokens: 10, totalTokens: 15 },
      'msg-1'
    )
  })

  it('onFinish callback does not throw when responseMessage is null', async () => {
    await executeSingleAgentStream(makeConfig())
    const opts = mockStreamText.getCapturedOptions() as Record<string, unknown>
    const onFinish = opts.onFinish as (p: { responseMessage: unknown }) => void

    expect(() => onFinish({ responseMessage: null })).not.toThrow()
  })
})

describe('stripUnavailableToolParts', () => {
  it('returns messages unchanged when there are no assistant tool parts', () => {
    const messages: UIMessage[] = [
      { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] } as any,
    ]
    const result = stripUnavailableToolParts(messages, new Set(['search']))
    expect(result).toEqual(messages)
  })

  it('keeps tool parts that are still available', () => {
    const messages: UIMessage[] = [
      {
        id: '1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'result' },
          { type: 'tool-search', toolCallId: 'tc1', toolName: 'search', state: 'result', result: 'found' } as any,
        ],
      } as any,
    ]
    const result = stripUnavailableToolParts(messages, new Set(['search']))
    expect(result[0].parts).toHaveLength(2)
  })

  it('strips tool parts that are no longer available', () => {
    const messages: UIMessage[] = [
      {
        id: '1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'result' },
          { type: 'tool-deleted_tool', toolCallId: 'tc1', toolName: 'deleted_tool', state: 'result', result: 'gone' } as any,
        ],
      } as any,
    ]
    const result = stripUnavailableToolParts(messages, new Set(['search']))
    expect(result[0].parts).toHaveLength(1)
    expect(result[0].parts[0].type).toBe('text')
  })

  it('replaces empty parts list with placeholder text to preserve role alternation', () => {
    const messages: UIMessage[] = [
      {
        id: '1',
        role: 'assistant',
        parts: [
          { type: 'tool-deleted', toolCallId: 'tc1', toolName: 'deleted', state: 'result', result: 'gone' } as any,
        ],
      } as any,
    ]
    const result = stripUnavailableToolParts(messages, new Set(['search']))
    expect(result[0].parts).toEqual([{ type: 'text', text: '' }])
  })

  it('handles dynamic-tool parts', () => {
    const messages: UIMessage[] = [
      {
        id: '1',
        role: 'assistant',
        parts: [
          { type: 'dynamic-tool', toolName: 'my_tool', toolCallId: 'tc1', state: 'result' } as any,
        ],
      } as any,
    ]
    // Tool is available
    const kept = stripUnavailableToolParts(messages, new Set(['my_tool']))
    expect(kept[0].parts).toHaveLength(1)

    // Tool is removed
    const stripped = stripUnavailableToolParts(messages, new Set(['other']))
    expect(stripped[0].parts).toEqual([{ type: 'text', text: '' }])
  })

  it('does not modify non-assistant messages', () => {
    const messages: UIMessage[] = [
      { id: '1', role: 'user', parts: [{ type: 'text', text: 'hello' }] } as any,
      { id: '2', role: 'system', parts: [{ type: 'text', text: 'system' }] } as any,
    ]
    const result = stripUnavailableToolParts(messages, new Set())
    expect(result).toEqual(messages)
  })
})
