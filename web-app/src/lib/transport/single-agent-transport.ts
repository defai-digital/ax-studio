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
import { extractErrorMessage } from '@/lib/utils/error'

const MCP_TOOL_USE_INSTRUCTION = `

## CRITICAL: AX-BI IS A TOOL SERVICE, NOT MATPLOTLIB

"AX-BI" refers to the AX-BI MCP server (a business intelligence tool), NOT matplotlib axes or any Python library.
When the user says "Use ax-bi", "upload to ax-bi", or similar, they want you to use the AX-BI MCP tools.
NEVER interpret "ax-bi" as matplotlib, pandas, or any Python code.

## CRITICAL: FILE PROCESSING - USE THE TOOL, NOT PYTHON

When the user attaches a file and says "upload", "process", "analyze", or similar:
1. STOP - Do NOT write any Python code
2. You HAVE the process_file_for_bi tool available - USE IT
3. Call process_file_for_bi with the file path from [Attached files: filename at /path]
4. That's it. The tool handles everything.

This is a LOCAL operation - the AX-BI engine runs on localhost. You are NOT uploading to an external server.

WRONG: Writing pandas/matplotlib code to process the file
WRONG: Saying "I cannot upload files to external servers"
RIGHT: Calling process_file_for_bi({file_path: "/path/to/file.xlsx", filename: "file.xlsx"})

## MCP tool use

When the user explicitly asks to use MCP, an MCP server, or a named tool service:
- Use the available tools instead of writing code, scripts, or instructions for the user to run.
- If the user says "MCP only", complete the task through tools or explain the exact tool error.
- Do not claim a dataset, file, chart, or dashboard does not exist until you have called the relevant list/search/info tool.

When the user asks to create, save, update, or add a chart/dashboard/report from a dataset/table/source:
- Treat it as a BI tool task even if the user does not say "MCP".
- Use chart/dashboard/data tools directly. Do not write Python, pandas, matplotlib, seaborn, SQL snippets, or instructions for the user to run.
- If tools cannot complete the request, return the actual tool error instead of creating a code fallback.

AX-BI MCP rules:
- For existing AX-BI datasets, first use dataset discovery tools such as list_datasets, search_business_assets, get_dataset_info, or get_schema.
- Do not call upload_file or upload_files unless the user attached a file or explicitly asked to upload/import a file.
- If the user names a dataset, pass that dataset name/search result forward instead of inventing or uploading replacement data.
- CRITICAL: All AX-BI MCP tools expect arguments wrapped in a 'request' key.
- CRITICAL: Use generate_chart with the correct schema:
  - Use 'dataset_id' (numeric), NOT 'dataset'
  - Use chart_type: 'xy' (NOT 'bar', 'line', etc.)
  - Use 'kind' field for chart type: 'bar', 'line', 'scatter'
  - x: { name: 'column_name' }
  - y: [{ name: 'column', aggregate: 'SUM', label: 'SUM(column)' }]
  - Example: generate_chart({ request: { dataset_id: 123, config: { chart_type: 'xy', x: { name: 'Product line' }, y: [{ name: 'Total', aggregate: 'SUM', label: 'SUM(Total)' }], kind: 'bar', orientation: 'vertical' } } })
- CRITICAL: Do NOT use create_chart_from_intent. It has broken intent parsing.
- When a chart/dashboard tool returns a URL, return that saved URL to the user.

File upload rules:
- When the user attaches a file and asks to upload it to AX-BI, use the process_file_for_bi tool IMMEDIATELY.
- Extract the file path from the message: [Attached files: filename at /path/to/file]
- Call process_file_for_bi with file_path and filename parameters.
- CRITICAL: Do NOT try to read, extract, or process the file yourself. The process_file_for_bi tool handles file reading internally.
- CRITICAL: Even if you see "Error: Failed to extract" or similar errors in the message, IGNORE them and call process_file_for_bi with the file path.
- Do NOT write Python code to read or process the file. Use the tool directly.
- Do NOT ask the user to paste the data or re-upload the file.

## CRITICAL: Stop after presenting the result
- After a tool call succeeds, present the result ONCE and STOP
- Do NOT repeat the same information multiple times
- Do NOT add "end", "done", "✅", or any closing markers
- Do NOT restate the URL or chart details more than once
- Write a single concise response (2-4 sentences max) then stop generating
- If you find yourself repeating information, STOP IMMEDIATELY`

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
    modelSupportsTools: _modelSupportsTools,
    onTokenUsage,
    mapUserInlineAttachments,
  } = config

  // Strip tool invocation parts for tools that are no longer available (e.g.,
  // fabric_search / fabric_extract when local knowledge is toggled off mid-conversation).
  // Without this, the LLM sees prior tool calls in history and tries to re-invoke them.
  const cleanedMessages = stripUnavailableToolParts(messages, new Set(Object.keys(tools)))

  const modelMessages = convertToModelMessages(mapUserInlineAttachments(cleanedMessages))

  const hasTools = Object.keys(tools).length > 0
  // Always enable tools when available - the model capability check is handled upstream
  const shouldEnableTools = hasTools

  const effectiveSystemMessage = shouldEnableTools
    ? `${systemMessage ?? ''}${MCP_TOOL_USE_INSTRUCTION}`
    : systemMessage

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
  let totalChars = 0
  let lastSpeedUpdate = 0

  const updateTokenSpeed = () => {
    if (!streamStartTime) return
    const durationMs = Date.now() - streamStartTime
    const tokenCount = Math.ceil(totalChars / 4)
    if (durationMs <= 0 || tokenCount <= 0) return

    const durationSec = durationMs / 1000
    const tokenSpeed = Math.round((tokenCount / durationSec) * 10) / 10
    useAppState.getState().setTokenSpeed(
      { id: 'streaming' } as never,
      tokenSpeed,
      tokenCount
    )
  }

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
        const now = Date.now()
        if (now - lastSpeedUpdate > 500) {
          lastSpeedUpdate = now
          updateTokenSpeed()
        }
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
          { id: 'streaming' } as never,
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
        const metadata = responseMessage.metadata as Record<string, unknown> | undefined
        const usage = metadata?.usage as LanguageModelUsage | undefined
        if (usage) {
          onTokenUsage?.(usage, responseMessage.id)
        }
      }
    },
  })
}
