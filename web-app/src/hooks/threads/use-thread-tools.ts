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

  const setSessionTools = (tools: QueuedTool[]) => {
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
  }

  const toolCallAbortController = useRef<AbortController | null>(null)

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
    [threadId]
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
            const approved = await useToolApproval
              .getState()
              .showApprovalModal(toolName, threadId, toolCall.input)

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
              result = await serviceHub.mcp().callTool({ toolName, arguments: toolCall.input })
            } else {
              result = { error: `Tool '${toolName}' not found in any service` }
            }

            if (result.error) {
              addToolOutput({
                state: 'output-error',
                tool: toolCall.toolName,
                toolCallId: toolCall.toolCallId,
                errorText: `Error: ${result.error}`,
              })
            } else {
              addToolOutput({ tool: toolCall.toolName, toolCallId: toolCall.toolCallId, output: result.content })
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
    [serviceHub, threadId, projectId]
  )

  return { toolCallAbortController, followUpMessage, onToolCall, startToolExecution }
}
