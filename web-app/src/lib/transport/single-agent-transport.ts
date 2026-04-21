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
import { stripUnavailableToolParts } from './transport-types'
import { useAppState } from '@/hooks/settings/useAppState'

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

  // Strip tool invocation parts for tools that are no longer available (e.g.,
  // fabric_search / fabric_extract when local knowledge is toggled off mid-conversation).
  // Without this, the LLM sees prior tool calls in history and tries to re-invoke them.
  const cleanedMessages = stripUnavailableToolParts(messages, new Set(Object.keys(tools)))

  const modelMessages = convertToModelMessages(mapUserInlineAttachments(cleanedMessages))

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
    stopWhen: shouldEnableTools ? stepCountIs(5) : stepCountIs(1),
  })

  let tokensPerSecond = 0
  let totalChars = 0

  return result.toUIMessageStream({
    messageMetadata: ({ part }) => {
      if (part.type === 'text-delta') {
        // AI SDK v5 fullStream text-delta parts use `text` (not `textDelta`).
        // Start timing from the FIRST token so TTFT (prefill/queue time) is
        // excluded — this gives pure generation speed, not end-to-end latency.
        const text = (part as { type: 'text-delta'; text: string }).text ?? ''
        if (!streamStartTime && text.length > 0) {
          streamStartTime = Date.now()
        }
        totalChars += text.length
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

        // Fall back to character-count estimate (~4 chars per token) when the
        // server does not return usage statistics (e.g. ax-serving without
        // stream_options.include_usage support).
        const tokenCount = outputTokens > 0 ? outputTokens : Math.ceil(totalChars / 4)

        let tokenSpeed: number
        if (durationSec > 0 && tokenCount > 0) {
          tokenSpeed = tokensPerSecond > 0 ? tokensPerSecond : tokenCount / durationSec
        } else {
          tokenSpeed = 0
        }

        useAppState.getState().setTokenSpeed(
          { id: '' } as any,
          Math.round(tokenSpeed * 10) / 10,
          tokenCount,
        )

        return {
          usage: {
            inputTokens,
            outputTokens: tokenCount,
            totalTokens: usage?.totalTokens ?? (inputTokens ?? 0) + tokenCount,
          },
          tokenSpeed: {
            tokenSpeed: Math.round(tokenSpeed * 10) / 10,
            tokenCount,
            durationMs,
          },
        }
      }

      return undefined
    },
    onError: (error) => {
      console.error('[SingleAgentTransport] stream error:', error)
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
