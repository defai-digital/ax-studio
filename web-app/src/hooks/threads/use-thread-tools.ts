/**
 * useThreadTools — encapsulates tool approval, cost approval, and agent team
 * coordination for a thread chat session.
 *
 * This hook returns state and callbacks that are passed to useChat and the
 * thread layout. It has no JSX and no dependency on streaming internals.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import type { UIMessage } from '@ai-sdk/react'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useThreads } from '@/hooks/threads/useThreads'
import { useAgentTeamStore } from '@/stores/agent-team-store'
import { useToolApproval } from '@/hooks/tools/useToolApproval'
import { useAppState } from '@/hooks/settings/useAppState'
import { useChatSessions, type SessionData } from '@/stores/chat-session-store'
import type { AgentTeam } from '@/types/agent-team'
import type { CostEstimate } from '@/lib/multi-agent/cost-estimation'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AddToolOutputFn = (...args: any[]) => any

export type ThreadToolsResult = {
  // Tool execution
  toolCallAbortController: React.MutableRefObject<AbortController | null>
  followUpMessage: (args: { messages: UIMessage[] }) => boolean
  onToolCall: (args: { toolCall: { toolName: string; toolCallId: string; input: unknown } }) => void
  startToolExecution: (addToolOutput: AddToolOutputFn) => void

  // Cost approval (passed to useChat as onCostApproval; modal state for JSX)
  onCostApproval: (estimate: CostEstimate) => Promise<boolean>
  costApprovalState: { estimate: CostEstimate; resolve: (approved: boolean) => void } | null
  setCostApprovalState: React.Dispatch<React.SetStateAction<ThreadToolsResult['costApprovalState']>>

  // Agent team
  agentTeams: AgentTeam[]
  activeTeamId: string | undefined
  activeTeam: AgentTeam | undefined
  showVariablePrompt: boolean
  setShowVariablePrompt: React.Dispatch<React.SetStateAction<boolean>>
  activeTeamSnapshot: AgentTeam | undefined
  teamHasVariables: boolean
  variablesFilled: boolean
  teamTokensUsed: number
  setTeamTokensUsed: React.Dispatch<React.SetStateAction<number>>
  handleVariableSubmit: (values: Record<string, string>) => Promise<void>
  handleTeamChange: (teamId: string | undefined) => Promise<void>
}

export function useThreadTools({
  threadId,
  projectId,
}: {
  threadId: string
  projectId: string | undefined
}): ThreadToolsResult {
  const serviceHub = useServiceHub()
  const thread = useThreads(useShallow((state) => state.threads[threadId]))
  const updateThread = useThreads((state) => state.updateThread)

  const getSessionData = useChatSessions((state) => state.getSessionData)
  const sessionData = getSessionData(threadId) as SessionData & { tools: { toolName: string; toolCallId: string; input: unknown }[] }

  const toolCallAbortController = useRef<AbortController | null>(null)

  // ─── Follow-up trigger ────────────────────────────────────────────────────

  const followUpMessage = useCallback(
    ({ messages }: { messages: UIMessage[] }): boolean => {
      if (
        !toolCallAbortController.current ||
        toolCallAbortController.current.signal.aborted
      ) {
        return false
      }

      // Don't trigger follow-up for multi-agent delegation tool calls.
      // These are already executed internally by the orchestrator Agent.
      const lastMsg = [...messages].reverse().find((m) => m.role === 'assistant')
      if (lastMsg) {
        const toolParts = lastMsg.parts.filter(
          (p: { type: string }) => p.type === 'tool-invocation'
        )
        if (toolParts.length > 0) {
          const allDelegation = toolParts.every((p: unknown) => {
            const name = (p as { toolInvocation?: { toolName?: string } })
              .toolInvocation?.toolName
            return (
              name?.startsWith('delegate_to_') ||
              name === 'run_all_agents_parallel'
            )
          })
          if (allDelegation) return false
        }
      }

      return lastAssistantMessageIsCompleteWithToolCalls({ messages })
    },
    []
  )

  // ─── Tool queue ───────────────────────────────────────────────────────────

  const onToolCall = useCallback(
    ({ toolCall }: { toolCall: { toolName: string; toolCallId: string; input: unknown } }) => {
      // Skip delegation tools — executed internally by the multi-agent orchestrator.
      if (
        toolCall.toolName.startsWith('delegate_to_') ||
        toolCall.toolName === 'run_all_agents_parallel'
      ) {
        return
      }
      sessionData.tools.push(toolCall)
    },
    [sessionData]
  )

  // ─── Tool execution (called from onFinish in ThreadDetail) ────────────────

  const startToolExecution = useCallback(
    (addToolOutput: AddToolOutputFn) => {
      toolCallAbortController.current = new AbortController()
      const signal = toolCallAbortController.current.signal

      const mcpToolNames = useAppState.getState().mcpToolNames

      ;(async () => {
        // Cache RAG tool names once per execution batch
        let ragToolNames: Set<string> | null = null
        try {
          const names = await serviceHub.rag().getToolNames()
          ragToolNames = new Set(names)
        } catch {
          ragToolNames = new Set()
        }

        for (const toolCall of sessionData.tools) {
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
              // Route to RAG service (per-thread document retrieval via AkiDB)
              result = await serviceHub.rag().callTool({
                toolName,
                arguments: toolCall.input as Record<string, unknown>,
                threadId,
                projectId,
                scope: projectId ? 'project' : 'thread',
              })
            } else if (mcpToolNames.has(toolName)) {
              result = await serviceHub.mcp().callTool({
                toolName,
                arguments: toolCall.input,
              })
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
              addToolOutput({
                tool: toolCall.toolName,
                toolCallId: toolCall.toolCallId,
                output: result.content,
              })
            }
          } catch (error) {
            if ((error as Error).name !== 'AbortError') {
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

        sessionData.tools = []
        toolCallAbortController.current = null
      })().catch((error) => {
        if (error.name !== 'AbortError') {
          console.error('Tool call error:', error)
        }
        sessionData.tools = []
        toolCallAbortController.current = null
      })
    },
    [serviceHub, sessionData, threadId, projectId]
  )

  // ─── Cost approval ────────────────────────────────────────────────────────

  const [costApprovalState, setCostApprovalState] = useState<{
    estimate: CostEstimate
    resolve: (approved: boolean) => void
  } | null>(null)

  const onCostApproval = useCallback(
    (estimate: CostEstimate): Promise<boolean> =>
      new Promise((resolve) => {
        setCostApprovalState({ estimate, resolve })
      }),
    []
  )

  // ─── Agent team ───────────────────────────────────────────────────────────

  const agentTeams = useAgentTeamStore((state) => state.teams)
  const agentTeamsLoaded = useAgentTeamStore((state) => state.isLoaded)
  const loadTeams = useAgentTeamStore((state) => state.loadTeams)
  const activeTeamId = (thread?.metadata?.agent_team_id as string) ?? undefined
  const activeTeam = agentTeams.find((t) => t.id === activeTeamId)

  const [showVariablePrompt, setShowVariablePrompt] = useState(false)
  const [teamTokensUsed, setTeamTokensUsed] = useState(0)

  const activeTeamSnapshot = thread?.metadata?.agent_team_snapshot as AgentTeam | undefined
  const teamHasVariables = !!(activeTeam?.variables && activeTeam.variables.length > 0)
  const variablesFilled = !!thread?.metadata?.agent_team_variables

  useEffect(() => {
    if (!agentTeamsLoaded) {
      loadTeams()
    }
  }, [agentTeamsLoaded, loadTeams])

  useEffect(() => {
    if (activeTeamId && teamHasVariables && !variablesFilled) {
      setShowVariablePrompt(true)
    }
  }, [activeTeamId, teamHasVariables, variablesFilled])

  const handleVariableSubmit = useCallback(
    async (values: Record<string, string>) => {
      if (!serviceHub || !threadId) return
      await updateThread(threadId, {
        metadata: {
          ...(thread?.metadata ?? {}),
          agent_team_variables: values,
        },
      })
      setShowVariablePrompt(false)
    },
    [serviceHub, threadId, thread?.metadata, updateThread]
  )

  const handleTeamChange = useCallback(
    async (teamId: string | undefined) => {
      if (!threadId) return
      await updateThread(threadId, {
        metadata: {
          ...(thread?.metadata ?? {}),
          agent_team_id: teamId ?? null,
          agent_team_snapshot: null,
          agent_team_variables: null,
        },
      })
    },
    [threadId, thread?.metadata, updateThread]
  )

  return {
    // Tool execution
    toolCallAbortController,
    followUpMessage,
    onToolCall,
    startToolExecution,

    // Cost approval
    onCostApproval,
    costApprovalState,
    setCostApprovalState,

    // Agent team
    agentTeams,
    activeTeamId,
    activeTeam,
    showVariablePrompt,
    setShowVariablePrompt,
    activeTeamSnapshot,
    teamHasVariables,
    variablesFilled,
    teamTokensUsed,
    setTeamTokensUsed,
    handleVariableSubmit,
    handleTeamChange,
  }
}
