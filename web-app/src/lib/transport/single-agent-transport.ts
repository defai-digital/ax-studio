import { type UIMessage } from '@ai-sdk/react'
import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  type LanguageModel,
  type Tool,
  type LanguageModelUsage,
} from 'ai'
import type { UIMessageChunk } from 'ai'
import type { TokenUsageCallback } from './transport-types'

export interface SingleAgentConfig {
  model: LanguageModel
  tools: Record<string, Tool>
  systemMessage: string | undefined
  messages: UIMessage[]
  abortSignal: AbortSignal | undefined
  modelSupportsTools: boolean
  onTokenUsage: TokenUsageCallback | undefined
  mapUserInlineAttachments: (messages: UIMessage[]) => UIMessage[]
}

export async function executeSingleAgentStream(
  config: SingleAgentConfig
): Promise<ReadableStream<UIMessageChunk>> {
  const {
    model,
    tools,
    systemMessage,
    messages,
    abortSignal,
    modelSupportsTools,
    onTokenUsage,
    mapUserInlineAttachments,
  } = config

  const modelMessages = convertToModelMessages(mapUserInlineAttachments(messages))

  const hasTools = Object.keys(tools).length > 0
  const shouldEnableTools = hasTools && modelSupportsTools

  let streamStartTime: number | undefined

  const result = streamText({
    model,
    messages: modelMessages,
    abortSignal,
    tools: shouldEnableTools ? tools : undefined,
    toolChoice: shouldEnableTools ? 'auto' : undefined,
    system: systemMessage,
    stopWhen: shouldEnableTools ? stepCountIs(3) : stepCountIs(1),
  })

  let tokensPerSecond = 0

  return result.toUIMessageStream({
    messageMetadata: ({ part }) => {
      if (part.type === 'start' && !streamStartTime) {
        streamStartTime = Date.now()
      }

      if (part.type === 'finish-step') {
        tokensPerSecond =
          (part.providerMetadata?.providerMetadata?.tokensPerSecond as number) || 0
      }

      if (part.type === 'finish') {
        const finishPart = part as {
          type: 'finish'
          totalUsage: LanguageModelUsage
          finishReason: string
        }
        const usage = finishPart.totalUsage
        const durationMs = streamStartTime ? Date.now() - streamStartTime : 0
        const durationSec = durationMs / 1000
        const outputTokens = usage?.outputTokens ?? 0
        const inputTokens = usage?.inputTokens

        let tokenSpeed: number
        if (durationSec > 0 && outputTokens > 0) {
          tokenSpeed = tokensPerSecond > 0 ? tokensPerSecond : outputTokens / durationSec
        } else {
          tokenSpeed = 0
        }

        return {
          usage: {
            inputTokens,
            outputTokens,
            totalTokens: usage?.totalTokens ?? (inputTokens ?? 0) + outputTokens,
          },
          tokenSpeed: {
            tokenSpeed: Math.round(tokenSpeed * 10) / 10,
            tokenCount: outputTokens,
            durationMs,
          },
        }
      }

      return undefined
    },
    onError: (error) => {
      if (error == null) return 'Unknown error'
      if (typeof error === 'string') return error
      if (error instanceof Error) return error.message
      return JSON.stringify(error)
    },
    onFinish: ({ responseMessage }) => {
      if (responseMessage) {
        const metadata = responseMessage.metadata as Record<string, unknown> | undefined
        const usage = metadata?.usage as LanguageModelUsage | undefined
        if (usage) {
          onTokenUsage?.(usage, responseMessage.id)
        }
      }
    },
  })
}
