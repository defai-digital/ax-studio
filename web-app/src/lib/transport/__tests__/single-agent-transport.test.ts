import { describe, it, expect, vi, beforeEach } from 'vitest'

// Use vi.hoisted so mocks are available when vi.mock factories execute
const { mockStreamText, mockConvertToModelMessages, mockStepCountIs } = vi.hoisted(() => ({
  mockStreamText: vi.fn(),
  mockConvertToModelMessages: vi.fn(),
  mockStepCountIs: vi.fn(),
}))

vi.mock('ai', () => ({
  streamText: mockStreamText,
  convertToModelMessages: mockConvertToModelMessages,
  stepCountIs: mockStepCountIs,
}))

import {
  executeSingleAgentStream,
  type SingleAgentConfig,
} from '../single-agent-transport'

function makeConfig(
  overrides: Partial<SingleAgentConfig> = {}
): SingleAgentConfig {
  return {
    model: { id: 'test-model' } as SingleAgentConfig['model'],
    tools: {},
    systemMessage: undefined,
    messages: [],
    abortSignal: undefined,
    modelSupportsTools: true,
    onTokenUsage: undefined,
    mapUserInlineAttachments: (msgs) => msgs,
    ...overrides,
  }
}

describe('executeSingleAgentStream', () => {
  let mockToUIMessageStream: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockConvertToModelMessages.mockReturnValue([{ role: 'user', content: 'hi' }])
    mockStepCountIs.mockImplementation((n: number) => `step-count-${n}`)
    mockToUIMessageStream = vi.fn().mockReturnValue(new ReadableStream())
    mockStreamText.mockReturnValue({ toUIMessageStream: mockToUIMessageStream })
  })

  // ─── Phase 1: Core functionality ───

  it('converts messages using mapUserInlineAttachments before convertToModelMessages', async () => {
    const mapper = vi.fn((msgs) => msgs.map(() => ({ id: '1', role: 'user' as const, parts: [] })))
    const messages = [{ id: 'm1', role: 'user' as const, parts: [] }]

    await executeSingleAgentStream(makeConfig({ messages, mapUserInlineAttachments: mapper }))

    expect(mapper).toHaveBeenCalledWith(messages)
    expect(mockConvertToModelMessages).toHaveBeenCalledWith(mapper(messages))
  })

  it('returns a ReadableStream', async () => {
    const result = await executeSingleAgentStream(makeConfig())
    expect(result).toBeInstanceOf(ReadableStream)
  })

  // ─── Phase 2: Tools logic ───

  it('passes tools when hasTools=true and modelSupportsTools=true', async () => {
    const tools = { myTool: {} as SingleAgentConfig['tools'][string] }
    await executeSingleAgentStream(makeConfig({ tools, modelSupportsTools: true }))

    const callArgs = mockStreamText.mock.calls[0][0]
    expect(callArgs.tools).toBe(tools)
    expect(callArgs.toolChoice).toBe('auto')
  })

  it('does not pass tools when modelSupportsTools=false', async () => {
    const tools = { myTool: {} as SingleAgentConfig['tools'][string] }
    await executeSingleAgentStream(makeConfig({ tools, modelSupportsTools: false }))

    const callArgs = mockStreamText.mock.calls[0][0]
    expect(callArgs.tools).toBeUndefined()
    expect(callArgs.toolChoice).toBeUndefined()
  })

  it('does not pass tools when tools object is empty', async () => {
    await executeSingleAgentStream(makeConfig({ tools: {}, modelSupportsTools: true }))

    const callArgs = mockStreamText.mock.calls[0][0]
    expect(callArgs.tools).toBeUndefined()
    expect(callArgs.toolChoice).toBeUndefined()
  })

  it('uses stepCountIs(5) when tools enabled, stepCountIs(1) otherwise', async () => {
    const tools = { t: {} as SingleAgentConfig['tools'][string] }

    await executeSingleAgentStream(makeConfig({ tools, modelSupportsTools: true }))
    expect(mockStepCountIs).toHaveBeenCalledWith(5)

    vi.clearAllMocks()
    mockConvertToModelMessages.mockReturnValue([])
    mockStepCountIs.mockImplementation((n: number) => `step-count-${n}`)
    mockStreamText.mockReturnValue({ toUIMessageStream: mockToUIMessageStream })

    await executeSingleAgentStream(makeConfig({ tools: {}, modelSupportsTools: true }))
    expect(mockStepCountIs).toHaveBeenCalledWith(1)
  })

  // ─── Phase 3: System message ───

  it('passes systemMessage to streamText', async () => {
    await executeSingleAgentStream(makeConfig({ systemMessage: 'Be helpful' }))
    const callArgs = mockStreamText.mock.calls[0][0]
    expect(callArgs.system).toBe('Be helpful')
  })

  it('passes undefined system when no systemMessage', async () => {
    await executeSingleAgentStream(makeConfig({ systemMessage: undefined }))
    const callArgs = mockStreamText.mock.calls[0][0]
    expect(callArgs.system).toBeUndefined()
  })

  // ─── Phase 4: messageMetadata callback ───

  it('messageMetadata returns undefined for non-finish parts', async () => {
    await executeSingleAgentStream(makeConfig())

    const streamCallArgs = mockToUIMessageStream.mock.calls[0][0]
    const metadataFn = streamCallArgs.messageMetadata

    expect(metadataFn({ part: { type: 'text-delta', text: 'hi' } })).toBeUndefined()
  })

  it('messageMetadata returns usage and tokenSpeed on finish part', async () => {
    await executeSingleAgentStream(makeConfig())

    const streamCallArgs = mockToUIMessageStream.mock.calls[0][0]
    const metadataFn = streamCallArgs.messageMetadata

    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    metadataFn({ part: { type: 'text-delta', text: 'Hello world' } })

    vi.spyOn(Date, 'now').mockReturnValue(now + 1000)

    const result = metadataFn({
      part: {
        type: 'finish',
        totalUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        finishReason: 'stop',
      },
    })

    expect(result).toHaveProperty('usage')
    expect(result.usage.inputTokens).toBe(10)
    expect(result.usage.outputTokens).toBe(20)
    expect(result.usage.totalTokens).toBe(30)
    expect(result).toHaveProperty('tokenSpeed')
    expect(result.tokenSpeed.durationMs).toBe(1000)
    expect(result.tokenSpeed.tokenCount).toBe(20)

    vi.restoreAllMocks()
  })

  it('falls back to char-based token estimate when outputTokens is 0', async () => {
    await executeSingleAgentStream(makeConfig())

    const streamCallArgs = mockToUIMessageStream.mock.calls[0][0]
    const metadataFn = streamCallArgs.messageMetadata

    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)

    metadataFn({ part: { type: 'text-delta', text: '12345678901234567890' } })
    vi.spyOn(Date, 'now').mockReturnValue(now + 2000)

    const result = metadataFn({
      part: {
        type: 'finish',
        totalUsage: { inputTokens: 5, outputTokens: 0, totalTokens: 5 },
        finishReason: 'stop',
      },
    })

    // 20 chars / 4 = 5 estimated tokens
    expect(result.usage.outputTokens).toBe(5)
    expect(result.tokenSpeed.tokenCount).toBe(5)

    vi.restoreAllMocks()
  })

  it('uses providerMetadata tokensPerSecond when available', async () => {
    await executeSingleAgentStream(makeConfig())

    const streamCallArgs = mockToUIMessageStream.mock.calls[0][0]
    const metadataFn = streamCallArgs.messageMetadata

    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    metadataFn({ part: { type: 'text-delta', text: 'hello' } })

    metadataFn({
      part: {
        type: 'finish-step',
        providerMetadata: { providerMetadata: { tokensPerSecond: 42.5 } },
      },
    })

    vi.spyOn(Date, 'now').mockReturnValue(now + 1000)

    const result = metadataFn({
      part: {
        type: 'finish',
        totalUsage: { inputTokens: 10, outputTokens: 50, totalTokens: 60 },
        finishReason: 'stop',
      },
    })

    expect(result.tokenSpeed.tokenSpeed).toBe(42.5)

    vi.restoreAllMocks()
  })

  it('returns tokenSpeed 0 when no duration and no tokens', async () => {
    await executeSingleAgentStream(makeConfig())

    const streamCallArgs = mockToUIMessageStream.mock.calls[0][0]
    const metadataFn = streamCallArgs.messageMetadata

    const result = metadataFn({
      part: {
        type: 'finish',
        totalUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        finishReason: 'stop',
      },
    })

    expect(result.tokenSpeed.tokenSpeed).toBe(0)
    expect(result.tokenSpeed.durationMs).toBe(0)
  })

  // ─── Phase 5: Error handling and onFinish ───

  it('onError returns message string for Error instances', async () => {
    await executeSingleAgentStream(makeConfig())

    const streamCallArgs = mockToUIMessageStream.mock.calls[0][0]
    const onError = streamCallArgs.onError

    expect(onError(new Error('test error'))).toBe('test error')
  })

  it('onError returns the string itself for string errors', async () => {
    await executeSingleAgentStream(makeConfig())

    const streamCallArgs = mockToUIMessageStream.mock.calls[0][0]
    const onError = streamCallArgs.onError

    expect(onError('string error')).toBe('string error')
  })

  it('onError returns "Unknown error" for null/undefined', async () => {
    await executeSingleAgentStream(makeConfig())

    const streamCallArgs = mockToUIMessageStream.mock.calls[0][0]
    const onError = streamCallArgs.onError

    expect(onError(null)).toBe('Unknown error')
    expect(onError(undefined)).toBe('Unknown error')
  })

  it('onError JSON-stringifies objects', async () => {
    await executeSingleAgentStream(makeConfig())

    const streamCallArgs = mockToUIMessageStream.mock.calls[0][0]
    const onError = streamCallArgs.onError

    expect(onError({ code: 42 })).toBe('{"code":42}')
  })

  it('onFinish calls onTokenUsage with usage from response metadata', async () => {
    const onTokenUsage = vi.fn()
    await executeSingleAgentStream(makeConfig({ onTokenUsage }))

    const streamCallArgs = mockToUIMessageStream.mock.calls[0][0]
    const onFinish = streamCallArgs.onFinish

    onFinish({
      responseMessage: {
        id: 'msg-123',
        metadata: {
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        },
      },
    })

    expect(onTokenUsage).toHaveBeenCalledWith(
      { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      'msg-123'
    )
  })

  it('onFinish does not call onTokenUsage when no usage in metadata', async () => {
    const onTokenUsage = vi.fn()
    await executeSingleAgentStream(makeConfig({ onTokenUsage }))

    const streamCallArgs = mockToUIMessageStream.mock.calls[0][0]
    const onFinish = streamCallArgs.onFinish

    onFinish({ responseMessage: { id: 'msg-123', metadata: {} } })
    expect(onTokenUsage).not.toHaveBeenCalled()
  })

  it('onFinish does not throw when responseMessage is undefined', async () => {
    await executeSingleAgentStream(makeConfig())

    const streamCallArgs = mockToUIMessageStream.mock.calls[0][0]
    const onFinish = streamCallArgs.onFinish

    expect(() => onFinish({ responseMessage: undefined })).not.toThrow()
  })
})
