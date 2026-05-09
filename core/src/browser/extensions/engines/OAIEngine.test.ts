import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { OAIEngine } from './OAIEngine'
import { events } from '../../events'
import {
  MessageEvent,
  InferenceEvent,
  MessageRequest,
} from '../../../types'

vi.mock('../../events')

class TestOAIEngine extends OAIEngine {
  inferenceUrl = 'http://test-inference-url'
  provider = 'test-provider'

  async headers() {
    return { Authorization: 'Bearer test-token' }
  }
}

describe('OAIEngine', () => {
  let engine: TestOAIEngine
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    engine = new TestOAIEngine('', '')
    vi.clearAllMocks()
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  it('should subscribe to events on load', () => {
    engine.onLoad()
    expect(events.on).toHaveBeenCalledWith(
      MessageEvent.OnMessageSent,
      expect.any(Function)
    )
    expect(events.on).toHaveBeenCalledWith(
      InferenceEvent.OnInferenceStopped,
      expect.any(Function)
    )
  })

  it('should remove event listeners on unload', () => {
    engine.onLoad()
    engine.onUnload()

    expect(events.off).toHaveBeenCalledWith(
      MessageEvent.OnMessageSent,
      expect.any(Function)
    )
    expect(events.off).toHaveBeenCalledWith(
      InferenceEvent.OnInferenceStopped,
      expect.any(Function)
    )
  })

  it('should stop inference', () => {
    engine.stopInference()
    expect(engine.isCancelled).toBe(true)
    expect(engine.controller.signal.aborted).toBe(true)
  })

  it('logs rejected inference requests triggered by the message event', async () => {
    const error = new Error('boom')
    vi.spyOn(engine, 'inference').mockRejectedValue(error)

    engine.onLoad()

    const messageHandler = vi
      .mocked(events.on)
      .mock.calls.find(([eventName]) => eventName === MessageEvent.OnMessageSent)?.[1] as
      | ((data: MessageRequest) => void)
      | undefined

    expect(messageHandler).toBeDefined()

    messageHandler?.({ attachments: [] } as MessageRequest)

    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[OAIEngine] Failed to run inference:',
        error
      )
    })
  })

  it('should guard against concurrent inference requests', async () => {
    const inferenceSpy = vi.spyOn(engine, 'inference').mockImplementation(() => new Promise(() => {}))

    engine.onLoad()

    const messageHandler = vi
      .mocked(events.on)
      .mock.calls.find(([eventName]) => eventName === MessageEvent.OnMessageSent)?.[1] as
      | ((data: MessageRequest) => void)
      | undefined

    expect(messageHandler).toBeDefined()

    messageHandler?.({ attachments: [] } as MessageRequest)
    messageHandler?.({ attachments: [] } as MessageRequest)

    await vi.waitFor(() => {
      expect(inferenceSpy).toHaveBeenCalledTimes(1)
    })
  })
})
