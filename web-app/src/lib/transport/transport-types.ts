import type { UIMessage, LanguageModelUsage } from '@ai-sdk/react'
import type { ChatRequestOptions, UIMessageChunk } from 'ai'

export type TokenUsageCallback = (
  usage: LanguageModelUsage,
  messageId: string
) => void

export type OnFinishCallback = (params: {
  message: UIMessage
  isAbort?: boolean
}) => void

export type OnToolCallCallback = (params: {
  toolCall: { toolCallId: string; toolName: string; input: unknown }
}) => void

export type ServiceHub = {
  mcp(): {
    getTools(): Promise<
      Array<{ name: string; description: string; inputSchema: unknown }>
    >
  }
  rag(): {
    getTools(): Promise<
      Array<{ name: string; description: string; inputSchema: unknown }>
    >
  }
}

export type SendMessagesOptions = {
  chatId: string
  messages: UIMessage[]
  abortSignal: AbortSignal | undefined
  trigger: 'submit-message' | 'regenerate-message'
  messageId: string | undefined
} & ChatRequestOptions

export type SendMessagesResult = Promise<ReadableStream<UIMessageChunk>>
