import { type UIMessage } from '@ai-sdk/react'
import {
  convertToModelMessages,
  streamText,
  stepCountIs,
  type LanguageModel,
  type LanguageModelUsage,
  type Tool,
} from 'ai'
import type { UIMessageChunk } from 'ai'

import { useAppState } from '@/hooks/settings/useAppState'
import { extractErrorMessage } from '@/lib/utils/error'
import { isDiffusionGemmaModelId } from '@/lib/mlx-ipc-fetch'

import type { TokenUsageCallback } from './transport-types'
import { stripUnavailableToolParts } from './transport-types'

const MCP_TOOL_USE_INSTRUCTION = `

## Tool use
Use an available tool when the user asks for MCP, a named tool service, or a BI action. Do not replace a requested tool action with Python, SQL, scripts, or instructions. Report the actual tool error if the action cannot be completed, and do not claim an asset is missing before using the relevant discovery tool.

AX BI means the local ax-bi MCP service, not matplotlib. AX BI tool arguments are wrapped in \`request\`. Discover named datasets before using them; upload only a user-attached file or one the user explicitly asked to import. Prefer \`prompt_to_dashboard({ request: { prompt } })\` for a complete dashboard and \`plan_dashboard\` only for a requested plan/dry run. Return a saved chart/dashboard URL once, followed by a concise result.

For an attached file marked \`[Attached files: name at /path]\`, call \`process_file_for_bi({ file_path, filename })\`; it performs the local read and upload. Do not read the file with generated code, ask the user to paste it, or treat extraction errors as a reason to skip the tool.`

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
    onTokenUsage,
    mapUserInlineAttachments,
  } = config

  // Strip tool invocation parts for tools that are no longer available (e.g.,
  // fabric_search / fabric_extract when local knowledge is toggled off mid-conversation).
  // Without this, the LLM sees prior tool calls in history and tries to re-invoke them.
  const cleanedMessages = stripUnavailableToolParts(
    messages,
    new Set(Object.keys(tools))
  )

  const modelMessages = await convertToModelMessages(
    mapUserInlineAttachments(cleanedMessages)
  )

  const hasTools = Object.keys(tools).length > 0
  // Always enable tools when available - the model capability check is handled upstream
  const shouldEnableTools = hasTools

  const effectiveSystemMessage = shouldEnableTools
    ? `${systemMessage ?? ''}${MCP_TOOL_USE_INSTRUCTION}`
    : systemMessage

  const requestStartTime = Date.now()
  const isBlockDiffusion = isDiffusionGemmaModelId(
    typeof model === 'string' ? model : model.modelId
  )
  let streamStartTime: number | undefined

  const result = streamText({
    model,
    messages: modelMessages,
    abortSignal,
    tools: shouldEnableTools ? tools : undefined,
    toolChoice: shouldEnableTools ? 'auto' : undefined,
    system: effectiveSystemMessage,
    stopWhen: shouldEnableTools ? stepCountIs(2) : stepCountIs(1),
  })

  let tokensPerSecond = 0
  let nativeGenerationDurationMs = 0
  let nativeGenerationTokens = 0
  let nativeDeliveryDurationMs = 0
  let nativeDeliveryTokens = 0
  let nativeRunnerDurationMs = 0
  let nativeRunnerTokens = 0
  let nativePromptEvalDurationMs = 0
  let nativeTotalDurationMs = 0
  let nativeTimeToFirstTokenMs: number | undefined
  let nativeAccelerationMode: 'mtp' | 'mtp_fallback' | 'direct' | undefined
  let nativeMtpDraftTokens = 0
  let nativeMtpAcceptedTokens = 0
  let nativeMtpDirectFallbackSteps = 0
  let hasNativeGenerationMetrics = false
  let totalChars = 0
  let lastSpeedUpdate = 0

  const updateTokenSpeed = () => {
    if (!streamStartTime) return
    const durationMs = Date.now() - streamStartTime
    const tokenCount = Math.ceil(totalChars / 4)
    if (durationMs <= 0 || tokenCount <= 0) return

    const durationSec = durationMs / 1000
    const tokenSpeed = Math.round((tokenCount / durationSec) * 10) / 10
    useAppState
      .getState()
      .setTokenSpeed({ id: 'streaming' }, tokenSpeed, tokenCount)
  }

  return result.toUIMessageStream({
    messageMetadata: ({ part }) => {
      if (part.type === 'text-delta') {
        // AI SDK v5 fullStream text-delta parts use `text` (not `textDelta`).
        // Autoregressive models are timed from the first token to exclude TTFT.
        // A diffusion model does all denoise work before its first visible
        // block, so timing only the block drain would report hundreds of t/s.
        const text = (part as { type: 'text-delta'; text: string }).text ?? ''
        if (!streamStartTime && text.length > 0) {
          streamStartTime = isBlockDiffusion ? requestStartTime : Date.now()
        }
        totalChars += text.length
        const now = Date.now()
        if (now - lastSpeedUpdate > 500) {
          lastSpeedUpdate = now
          updateTokenSpeed()
        }
      }

      if (part.type === 'finish-step') {
        const providerMetadata = part.providerMetadata as
          | Record<string, unknown>
          | undefined
        const axEngineMetrics = providerMetadata?.axEngine as
          | Record<string, unknown>
          | undefined
        const legacyMetrics = providerMetadata?.providerMetadata as
          | Record<string, unknown>
          | undefined
        const hasBlockDiffusionMetrics =
          axEngineMetrics?.generationKind === 'block_diffusion'
        const reportedGenerationDurationMs =
          axEngineMetrics?.generationDurationMs
        const reportedGenerationTokens =
          axEngineMetrics?.generationTokenCount
        const hasVersionedGenerationMetrics =
          typeof reportedGenerationDurationMs === 'number' &&
          Number.isFinite(reportedGenerationDurationMs) &&
          reportedGenerationDurationMs >= 0 &&
          typeof reportedGenerationTokens === 'number' &&
          Number.isFinite(reportedGenerationTokens) &&
          reportedGenerationTokens >= 0

        // AX Engine measures the generation phase with a monotonic clock at
        // the native stream boundary. Use that report for both autoregressive
        // and block-diffusion models so Studio, Ollama-style eval metrics, and
        // LM Studio-style generation speed share the same denominator.
        if (hasVersionedGenerationMetrics) {
          hasNativeGenerationMetrics = true
          nativeGenerationDurationMs += reportedGenerationDurationMs
          nativeGenerationTokens += reportedGenerationTokens

          const reportedDeliveryDurationMs =
            axEngineMetrics?.deliveryDurationMs
          const reportedDeliveryTokens = axEngineMetrics?.deliveryTokenCount
          if (
            typeof reportedDeliveryDurationMs === 'number' &&
            Number.isFinite(reportedDeliveryDurationMs) &&
            reportedDeliveryDurationMs >= 0 &&
            typeof reportedDeliveryTokens === 'number' &&
            Number.isFinite(reportedDeliveryTokens) &&
            reportedDeliveryTokens >= 0
          ) {
            nativeDeliveryDurationMs += reportedDeliveryDurationMs
            nativeDeliveryTokens += reportedDeliveryTokens
          }

          const reportedRunnerDurationMs = axEngineMetrics?.runnerDurationMs
          if (
            typeof reportedRunnerDurationMs === 'number' &&
            Number.isFinite(reportedRunnerDurationMs) &&
            reportedRunnerDurationMs >= 0
          ) {
            nativeRunnerDurationMs += reportedRunnerDurationMs
            nativeRunnerTokens += reportedGenerationTokens
          }

          const reportedPromptEvalDurationMs =
            axEngineMetrics?.promptEvalDurationMs
          if (
            typeof reportedPromptEvalDurationMs === 'number' &&
            Number.isFinite(reportedPromptEvalDurationMs) &&
            reportedPromptEvalDurationMs >= 0
          ) {
            nativePromptEvalDurationMs += reportedPromptEvalDurationMs
          }

          const reportedTotalDurationMs = axEngineMetrics?.totalDurationMs
          nativeTotalDurationMs +=
            typeof reportedTotalDurationMs === 'number' &&
            Number.isFinite(reportedTotalDurationMs) &&
            reportedTotalDurationMs >= 0
              ? reportedTotalDurationMs
              : reportedGenerationDurationMs

          const reportedTimeToFirstTokenMs =
            axEngineMetrics?.timeToFirstTokenMs
          if (
            nativeTimeToFirstTokenMs == null &&
            typeof reportedTimeToFirstTokenMs === 'number' &&
            Number.isFinite(reportedTimeToFirstTokenMs) &&
            reportedTimeToFirstTokenMs >= 0
          ) {
            nativeTimeToFirstTokenMs = reportedTimeToFirstTokenMs
          }

          const reportedAccelerationMode = axEngineMetrics?.accelerationMode
          if (reportedAccelerationMode === 'mtp') {
            nativeAccelerationMode = 'mtp'
          } else if (
            reportedAccelerationMode === 'mtp_fallback' &&
            nativeAccelerationMode !== 'mtp'
          ) {
            nativeAccelerationMode = 'mtp_fallback'
          } else if (
            reportedAccelerationMode === 'direct' &&
            nativeAccelerationMode == null
          ) {
            nativeAccelerationMode = 'direct'
          }

          const reportedMtpDraftTokens = axEngineMetrics?.mtpDraftTokens
          const reportedMtpAcceptedTokens = axEngineMetrics?.mtpAcceptedTokens
          const reportedMtpDirectFallbackSteps =
            axEngineMetrics?.mtpDirectFallbackSteps
          if (
            typeof reportedMtpDraftTokens === 'number' &&
            Number.isFinite(reportedMtpDraftTokens) &&
            reportedMtpDraftTokens >= 0
          ) {
            nativeMtpDraftTokens += reportedMtpDraftTokens
          }
          if (
            typeof reportedMtpAcceptedTokens === 'number' &&
            Number.isFinite(reportedMtpAcceptedTokens) &&
            reportedMtpAcceptedTokens >= 0
          ) {
            nativeMtpAcceptedTokens += reportedMtpAcceptedTokens
          }
          if (
            typeof reportedMtpDirectFallbackSteps === 'number' &&
            Number.isFinite(reportedMtpDirectFallbackSteps) &&
            reportedMtpDirectFallbackSteps >= 0
          ) {
            nativeMtpDirectFallbackSteps += reportedMtpDirectFallbackSteps
          }

          tokensPerSecond =
            nativeGenerationDurationMs > 0
              ? (nativeGenerationTokens * 1000) / nativeGenerationDurationMs
              : 0
        } else if (hasBlockDiffusionMetrics) {
          // Compatibility with AX Studio builds that predate the versioned
          // performance report. Their total elapsed time is still the correct
          // denominator for block diffusion.
          const reportedElapsedMs = axEngineMetrics?.elapsedMs
          const reportedOutputTokens = axEngineMetrics?.outputTokenCount
          if (
            typeof reportedElapsedMs === 'number' &&
            Number.isFinite(reportedElapsedMs) &&
            reportedElapsedMs >= 0 &&
            typeof reportedOutputTokens === 'number' &&
            Number.isFinite(reportedOutputTokens) &&
            reportedOutputTokens >= 0
          ) {
            // A tool round-trip creates another model step. Accumulate each
            // native request instead of pairing total usage with only the last
            // step's elapsed time and rate.
            hasNativeGenerationMetrics = true
            nativeGenerationDurationMs += reportedElapsedMs
            nativeTotalDurationMs += reportedElapsedMs
            nativeGenerationTokens += reportedOutputTokens
            tokensPerSecond =
              nativeGenerationDurationMs > 0
                ? (nativeGenerationTokens * 1000) /
                  nativeGenerationDurationMs
                : 0
          }
        } else {
          const reportedSpeed = legacyMetrics?.tokensPerSecond
          tokensPerSecond =
            typeof reportedSpeed === 'number' && Number.isFinite(reportedSpeed)
              ? reportedSpeed
              : 0
        }
      }

      if (part.type === 'finish') {
        const finishPart = part as {
          type: 'finish'
          totalUsage: LanguageModelUsage
          finishReason: string
        }
        const usage = finishPart.totalUsage
        const durationMs =
          hasNativeGenerationMetrics
            ? nativeGenerationDurationMs
            : streamStartTime
              ? Date.now() - streamStartTime
              : 0
        const durationSec = durationMs / 1000
        const outputTokens = usage?.outputTokens ?? 0
        const inputTokens = usage?.inputTokens

        // Fall back to character-count estimate (~4 chars per token) when the
        // server does not return usage statistics (e.g. ax-serving without
        // stream_options.include_usage support).
        const tokenCount =
          outputTokens > 0 ? outputTokens : Math.ceil(totalChars / 4)

        let tokenSpeed: number
        if (durationSec > 0 && tokenCount > 0) {
          tokenSpeed =
            tokensPerSecond > 0 ? tokensPerSecond : tokenCount / durationSec
        } else {
          tokenSpeed = 0
        }
        const totalDurationMs = hasNativeGenerationMetrics
          ? nativeTotalDurationMs
          : Date.now() - requestStartTime
        const timeToFirstTokenMs =
          nativeTimeToFirstTokenMs ??
          (streamStartTime ? streamStartTime - requestStartTime : undefined)
        const mtpAcceptanceRate =
          nativeMtpDraftTokens > 0
            ? nativeMtpAcceptedTokens / nativeMtpDraftTokens
            : undefined
        const deliveryTokenSpeed =
          nativeDeliveryDurationMs > 0 && nativeDeliveryTokens > 0
            ? (nativeDeliveryTokens * 1000) / nativeDeliveryDurationMs
            : undefined
        const runnerTokenSpeed =
          nativeRunnerDurationMs > 0 && nativeRunnerTokens > 0
            ? (nativeRunnerTokens * 1000) / nativeRunnerDurationMs
            : undefined
        useAppState
          .getState()
          .setTokenSpeed(
            { id: 'streaming' },
            Math.round(tokenSpeed * 10) / 10,
            tokenCount
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
            generationTokenCount: hasNativeGenerationMetrics
              ? nativeGenerationTokens
              : tokenCount,
            deliveryTokenSpeed,
            deliveryDurationMs: nativeDeliveryDurationMs || undefined,
            deliveryTokenCount: nativeDeliveryTokens || undefined,
            runnerTokenSpeed,
            runnerDurationMs: nativeRunnerDurationMs || undefined,
            promptEvalDurationMs: nativePromptEvalDurationMs || undefined,
            totalDurationMs,
            timeToFirstTokenMs,
            accelerationMode: nativeAccelerationMode,
            mtpAcceptanceRate,
            mtpDraftTokens: nativeMtpDraftTokens || undefined,
            mtpAcceptedTokens: nativeMtpAcceptedTokens || undefined,
            mtpDirectFallbackSteps:
              nativeMtpDirectFallbackSteps || undefined,
          },
        }
      }

      return undefined
    },
    onError: (error) => {
      console.error('[SingleAgentTransport] stream error:', error)
      return extractErrorMessage(error, 'Unknown error')
    },
    onFinish: ({ responseMessage }) => {
      if (responseMessage) {
        const metadata = responseMessage.metadata as
          | Record<string, unknown>
          | undefined
        const usage = metadata?.usage as LanguageModelUsage | undefined
        if (usage) {
          onTokenUsage?.(usage, responseMessage.id)
        }
      }
    },
  })
}
