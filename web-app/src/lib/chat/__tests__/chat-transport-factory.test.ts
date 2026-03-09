import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createChatTransport } from '../chat-transport-factory'

vi.mock('@/lib/custom-chat-transport', () => ({
  CustomChatTransport: vi.fn().mockImplementation((...args: unknown[]) => ({ args })),
}))

import { CustomChatTransport } from '@/lib/custom-chat-transport'

beforeEach(() => {
  vi.mocked(CustomChatTransport).mockClear()
})

describe('createChatTransport', () => {
  it('constructs a CustomChatTransport with provided options', () => {
    const params = {
      systemMessage: 'You are helpful',
      sessionId: 's1',
      inferenceParameters: { temperature: 0.7 },
      modelOverrideId: 'model-x',
    }
    createChatTransport(params)
    expect(CustomChatTransport).toHaveBeenCalledWith(
      params.systemMessage,
      params.sessionId,
      params.inferenceParameters,
      params.modelOverrideId
    )
  })

  it('passes undefined for missing options', () => {
    createChatTransport({})
    expect(CustomChatTransport).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
      undefined
    )
  })

  it('returns the transport instance', () => {
    const transport = createChatTransport({ sessionId: 'test' })
    expect(transport).toBeDefined()
  })

  it('creates a new instance on each call', () => {
    createChatTransport({})
    createChatTransport({})
    expect(CustomChatTransport).toHaveBeenCalledTimes(2)
  })
})
