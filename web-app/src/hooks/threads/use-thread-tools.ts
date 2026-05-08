/**
 * useThreadTools — encapsulates tool approval for a thread chat session.
 *
 * Returns state and callbacks passed to useChat and the thread layout.
 * No JSX, no dependency on streaming internals.
 */

import { useCallback, useRef } from 'react'
import { lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import type { UIMessage } from '@ai-sdk/react'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useToolApproval } from '@/hooks/tools/useToolApproval'
import { useAppState } from '@/hooks/settings/useAppState'
import { useChatSessions } from '@/stores/chat-session-store'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AddToolOutputFn = (...args: any[]) => any

export type ThreadToolsResult = {
  toolCallAbortController: React.MutableRefObject<AbortController | null>
  followUpMessage: (args: { messages: UIMessage[] }) => boolean
  onToolCall: (args: { toolCall: { toolName: string; toolCallId: string; input: unknown } }) => void
  startToolExecution: (addToolOutput: AddToolOutputFn) => void
  resetTurnState: () => void
}

type ToolResultContent = Array<{ type?: string; text?: string }>

function fabricSearchHasResults(result: { content?: ToolResultContent } | undefined): boolean {
  const text = result?.content?.find((part) => part?.type === 'text' && part.text)?.text
  if (!text) return false
  try {
    const parsed = JSON.parse(text) as { results?: unknown[] }
    return Array.isArray(parsed.results) && parsed.results.length > 0
  } catch {
    return !text.includes('"results":[]')
  }
}

const KEYWORD_STOP_WORDS = new Set([
  'what',
  'which',
  'who',
  'whom',
  'whose',
  'when',
  'where',
  'why',
  'how',
  'did',
  'does',
  'the',
  'and',
  'that',
  'this',
  'with',
  'from',
  'into',
  'about',
  'author',
  'achieve',
  'achieved',
])

function pushUnique(values: string[], value: string) {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (normalized && !values.includes(normalized)) values.push(normalized)
}

function buildKeywordFallbackQueries(query: string): string[] {
  const queries: string[] = []
  pushUnique(queries, query)

  const titleMatches = query.match(/\b[A-Z][\w-]*(?:\s+[A-Z][\w-]*){1,6}\b/g) ?? []
  const longestTitle = titleMatches
    .map((value) => value.trim())
    .sort((a, b) => b.length - a.length)[0]
  if (longestTitle) {
    if (/\b(hir\w*|job|role|outcome|result)\b/i.test(query)) {
      pushUnique(queries, `${longestTitle} hired`)
    }
    pushUnique(queries, longestTitle)
  }

  const significantTerms = query
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length > 3 && !KEYWORD_STOP_WORDS.has(term.toLowerCase()))
    .slice(0, 8)
    .join(' ')
  pushUnique(queries, significantTerms)

  return queries
}

async function retryFabricSearchWithKeywordFallback({
  serviceHub,
  result,
  toolInput,
}: {
  serviceHub: ReturnType<typeof useServiceHub>
  result: { error?: string; content?: ToolResultContent }
  toolInput: unknown
}) {
  if (fabricSearchHasResults(result)) return result

  const input = toolInput && typeof toolInput === 'object'
    ? { ...(toolInput as Record<string, unknown>) }
    : {}
  const query = String(input.query ?? '').trim()
  if (!query) return result

  const requestedMode = String(input.mode ?? 'vector')
  if (requestedMode === 'keyword' && input.layer === 'raw') return result

  for (const fallbackQuery of buildKeywordFallbackQueries(query)) {
    try {
      const fallback = await serviceHub.mcp().callTool({
        toolName: 'fabric_search',
        arguments: {
          ...input,
          query: fallbackQuery,
          mode: 'keyword',
          layer: 'raw',
        },
      })

      if (fabricSearchHasResults(fallback)) return fallback
    } catch (error) {
      console.warn('[LocalKnowledge] keyword fallback search failed:', error)
    }
  }

  return result
}

export function useThreadTools({
  threadId,
  projectId,
}: {
  threadId: string
  projectId: string | undefined
}): ThreadToolsResult {
  const serviceHub = useServiceHub()

  type QueuedTool = {
    toolName: string
    toolCallId: string
    input: unknown
  }

  const setSessionTools = useCallback((tools: QueuedTool[]) => {
    useChatSessions.setState((state) => {
      const session = state.sessions[threadId]
      if (session) {
        return {
          sessions: {
            ...state.sessions,
            [threadId]: { ...session, data: { ...session.data, tools } },
          },
        }
      }
      const standaloneData = state.standaloneData[threadId]
      if (!standaloneData) return state
      return {
        standaloneData: {
          ...state.standaloneData,
          [threadId]: { ...standaloneData, tools },
        },
      }
    })
  }, [threadId])

  const toolCallAbortController = useRef<AbortController | null>(null)

  // Persists across multiple startToolExecution calls within one chat turn.
  // Prevents the model from calling fabric_search more than once per turn.
  const fabricSearchUsedInTurn = useRef(false)

  const followUpMessage = useCallback(
    ({ messages }: { messages: UIMessage[] }): boolean => {
      if (!toolCallAbortController.current || toolCallAbortController.current.signal.aborted) {
        return false
      }
      return lastAssistantMessageIsCompleteWithToolCalls({ messages })
    },
    []
  )

  const onToolCall = useCallback(
    ({ toolCall }: { toolCall: { toolName: string; toolCallId: string; input: unknown } }) => {
      const state = useChatSessions.getState()
      const currentTools = state.ensureSessionData(threadId)
      const updatedTools = [...(currentTools.tools as QueuedTool[]), toolCall as QueuedTool]
      setSessionTools(updatedTools)
    },
    [setSessionTools, threadId]
  )

  const startToolExecution = useCallback(
    (addToolOutput: AddToolOutputFn) => {
      toolCallAbortController.current = new AbortController()
      const signal = toolCallAbortController.current.signal

      const mcpToolNames = useAppState.getState().mcpToolNames
      const state = useChatSessions.getState()
      const queuedTools = state.ensureSessionData(threadId).tools as QueuedTool[]

      ;(async () => {
        let ragToolNames: Set<string> | null = null
        try {
          const names = await serviceHub.rag().getToolNames()
          ragToolNames = new Set(names)
        } catch {
          ragToolNames = new Set()
        }

        for (const toolCall of queuedTools) {
          if (signal.aborted) break
          try {
            const toolName = toolCall.toolName

            // Reject duplicate fabric_search calls — return the instruction to answer
            if (toolName === 'fabric_search' && fabricSearchUsedInTurn.current) {
              addToolOutput({
                tool: toolCall.toolName,
                toolCallId: toolCall.toolCallId,
                output: [{
                  type: 'text',
                  text: 'STOP. fabric_search was already called. You MUST NOT call it again. Write your complete answer now using the previous search results. Do NOT call any tools. Just write your answer text immediately.',
                }],
              })
              continue
            }

            const approved = await useToolApproval
              .getState()
              .showApprovalModal(toolName, threadId, toolCall.input as Record<string, unknown>)

            if (!approved) {
              addToolOutput({
                state: 'output-error',
                tool: toolCall.toolName,
                toolCallId: toolCall.toolCallId,
                errorText: 'Tool execution denied by user',
              })
              continue
            }

            let result
            if (ragToolNames && ragToolNames.has(toolName)) {
              result = await serviceHub.rag().callTool({
                toolName,
                arguments: toolCall.input as Record<string, unknown>,
                threadId,
                projectId,
                scope: projectId ? 'project' : 'thread',
              })
            } else if (mcpToolNames.has(toolName)) {
              result = await serviceHub.mcp().callTool({ toolName, arguments: toolCall.input as Record<string, unknown> })
            } else {
              result = { error: `Tool '${toolName}' not found in any service` }
            }

            // Mark fabric_search as called
            if (toolName === 'fabric_search' && !result.error) {
              fabricSearchUsedInTurn.current = true
            }

            if (toolName === 'fabric_search') {
              result = await retryFabricSearchWithKeywordFallback({
                serviceHub,
                result,
                toolInput: toolCall.input,
              })
            }

            if (result.error) {
              addToolOutput({
                state: 'output-error',
                tool: toolCall.toolName,
                toolCallId: toolCall.toolCallId,
                errorText: `Error: ${result.error}`,
              })
            } else {
              // For fabric_search, append an instruction to the tool result so the model
              // knows to answer immediately and not call the tool again.
              let output = result.content
              if (toolName === 'fabric_search' && Array.isArray(output)) {
                const hasResults = output.some(
                  (c: { type?: string; text?: string }) =>
                    c?.type === 'text' && c.text && c.text.includes('"results"')
                )
                if (hasResults) {
                  output = [
                    ...output,
                    {
                      type: 'text',
                      text: '\n\n---\nLOCAL_KNOWLEDGE_RESULT_READY\nINSTRUCTION: The fabric_search tool has already completed. You MUST now write the final answer in normal prose.\n\nCRITICAL RULES:\n- Do NOT call fabric_search or any other tool again\n- Do NOT output <tool_call>, </tool_call>, JSON tool-call objects, or function-call markup\n- Do NOT say "let me search" or "I need more information"\n- Do NOT say "let me" or "I will explain"\n- Work with the results you have — even if they seem incomplete\n- Start with the direct answer to the user question\n- If the results are incomplete, say so in your answer and describe what you found\n- Your response must be at least 100 words',
                    },
                  ]
                }
              }
              addToolOutput({ tool: toolCall.toolName, toolCallId: toolCall.toolCallId, output })
            }
          } catch (error) {
            const isAbort = error instanceof Error && error.name === 'AbortError'
            if (!isAbort) {
              console.error('Tool call error:', error)
              addToolOutput({
                state: 'output-error',
                tool: toolCall.toolName,
                toolCallId: toolCall.toolCallId,
                errorText: `Error: ${error instanceof Error ? error.message : String(error)}`,
              })
            }
          }
        }

        const processedIds = new Set(queuedTools.map((t: QueuedTool) => t.toolCallId))
        const currentTools = (useChatSessions.getState().ensureSessionData(threadId).tools ?? []) as QueuedTool[]
        setSessionTools(currentTools.filter((t) => !processedIds.has(t.toolCallId)))
        toolCallAbortController.current = null
      })().catch((error) => {
        const isAbort = error instanceof Error && error.name === 'AbortError'
        if (!isAbort) console.error('Tool call error:', error)
        setSessionTools([])
        toolCallAbortController.current = null
      })
    },
    [serviceHub, setSessionTools, threadId, projectId]
  )

  return { toolCallAbortController, followUpMessage, onToolCall, startToolExecution, resetTurnState: () => { fabricSearchUsedInTurn.current = false } }
}
