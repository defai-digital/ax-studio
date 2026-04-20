import { AIEngine, chatCompletionRequest, chatCompletionChunk } from './AIEngine'
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
  transformPayload?: (payload: chatCompletionRequest) => chatCompletionRequest

  // Transform the response
  transformResponse?: (response: chatCompletionChunk) => chatCompletionChunk

  // Idempotency guard — see `onLoad`/`onUnload` below. Without this,
  // re-entering `onLoad()` (extension manager re-initialization, HMR)
  // registers another set of `OnMessageSent` / `OnInferenceStopped`
  // listeners, so each chat message triggers N concurrent `inference()`
  // calls.
  private loaded = false

  private readonly handleMessageSent = (data: MessageRequest) => {
    this.resetInferenceController()
    void Promise.resolve()
      .then(() => this.inference(data))
      .catch((error) => {
        console.error('[OAIEngine] Failed to run inference:', error)
        events.emit(MessageEvent.OnMessageResponse, {
          ...data,
          status: 'error',
          error: String(error?.message ?? error),
        } as any)
      })
  }

  private readonly handleInferenceStopped = () => {
    this.stopInference()
  }

  /**
   * Create a fresh AbortController and clear the cancelled flag.
   * Subclass `inference()` implementations can also call this defensively
   * if they enter inference through another code path (retries, fallbacks).
   */
  protected resetInferenceController() {
    if (this.controller && !this.controller.signal.aborted) {
      this.controller.abort()
    }
    this.controller = new AbortController()
    this.isCancelled = false
  }

  /**
   * On extension load, subscribe to events.
   */
  override onLoad() {
    if (this.loaded) return
    this.loaded = true
    super.onLoad()
    events.on(MessageEvent.OnMessageSent, this.handleMessageSent)
    events.on(InferenceEvent.OnInferenceStopped, this.handleInferenceStopped)
  }

  /**
   * On extension unload
   */
  override onUnload(): void {
    this.loaded = false
    events.off(MessageEvent.OnMessageSent, this.handleMessageSent)
    events.off(InferenceEvent.OnInferenceStopped, this.handleInferenceStopped)
  }

  inference(data: MessageRequest): void | Promise<unknown> {}

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
