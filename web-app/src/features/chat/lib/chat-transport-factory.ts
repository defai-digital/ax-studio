/**
 * chat-transport-factory — decouples transport instantiation from hook lifecycle.
 * Accepts plain value options so callers (hooks, tests) don't construct
 * CustomChatTransport directly, keeping the transport boundary clean.
 */
import { CustomChatTransport } from '@/lib/custom-chat-transport'

export type TransportOptions = {
  systemMessage?: string
  sessionId?: string
  inferenceParameters?: Record<string, unknown>
  modelOverrideId?: string
}

export function createChatTransport(options: TransportOptions): CustomChatTransport {
  return new CustomChatTransport(
    options.systemMessage,
    options.sessionId,
    options.inferenceParameters,
    options.modelOverrideId
  )
}
