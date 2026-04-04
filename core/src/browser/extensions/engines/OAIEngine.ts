import { AIEngine } from './AIEngine'
import {
  InferenceEvent,
  MessageEvent,
  MessageRequest,
  Model,
} from '../../../types'
import { events } from '../../events'

/**
 * Base OAI Inference Provider
 * Applicable to all OAI compatible inference providers
 */
export abstract class OAIEngine extends AIEngine {
  // The inference engine
  abstract inferenceUrl: string

  // Controller to handle stop requests
  controller = new AbortController()
  isCancelled = false

  // The loaded model instance
  loadedModel: Model | undefined

  // Transform the payload
  transformPayload?: Function

  // Transform the response
  transformResponse?: Function

  private readonly handleMessageSent = (data: MessageRequest) => {
    this.inference(data)
  }

  private readonly handleInferenceStopped = () => {
    this.stopInference()
  }

  /**
   * On extension load, subscribe to events.
   */
  override onLoad() {
    super.onLoad()
    events.on(MessageEvent.OnMessageSent, this.handleMessageSent)
    events.on(InferenceEvent.OnInferenceStopped, this.handleInferenceStopped)
  }

  /**
   * On extension unload
   */
  override onUnload(): void {
    events.off(MessageEvent.OnMessageSent, this.handleMessageSent)
    events.off(InferenceEvent.OnInferenceStopped, this.handleInferenceStopped)
  }

  inference(data: MessageRequest) {}

  /**
   * Stops the inference.
   */
  stopInference() {
    this.isCancelled = true
    this.controller?.abort()
  }

  /**
   * Headers for the inference request
   */
  async headers(): Promise<HeadersInit> {
    return {}
  }
}
