import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeSingleAgentStream } from '../single-agent-transport'
import { stripUnavailableToolParts } from '../transport-types'
import type { SingleAgentConfig } from '../single-agent-transport'
import type { UIMessage } from '@ai-sdk/react'

// ─── Mock ai module ───────────────────────────────────────────────────────

const mockStreamText = vi.hoisted(() => {
  const listeners: Record<string, (...args: unknown[]) => unknown> = {}

  const result = {
    toUIMessageStream: vi.fn(() => {
      return new ReadableStream({
        start(controller) {
          controller.close()
        },
      })
    }),
  }

  return { result, listeners }
})

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    streamText: vi.fn(() => mockStreamText.result),
  }
})

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
