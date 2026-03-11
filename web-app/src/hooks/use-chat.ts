import { createChatTransport } from '@/lib/chat/chat-transport-factory'
import {
  Chat,
  type UIMessage,
  type UseChatOptions,
  useChat as useChatSDK,
} from '@ai-sdk/react'
import {
  type ChatInit,
  type LanguageModelUsage,
} from 'ai'
import { z } from 'zod/v4'
import { useEffect, useMemo, useRef, useCallback } from 'react'
import { useChatSessions } from '@/stores/chat-session-store'
import { useAppState } from '@/hooks/useAppState'

type CustomChatOptions = Omit<ChatInit<UIMessage>, 'transport'> &
  Pick<UseChatOptions<UIMessage>, 'experimental_throttle' | 'resume'> & {
    sessionId?: string
    sessionTitle?: string
    systemMessage?: string
    inferenceParameters?: Record<string, unknown>
    modelOverrideId?: string
    activeTeamId?: string
    onTokenUsage?: (usage: LanguageModelUsage, messageId: string) => void
    onCostApproval?: (estimate: import('@/lib/multi-agent/cost-estimation').CostEstimate) => Promise<boolean>
  }

// This is a wrapper around the AI SDK's useChat hook
// It implements model switching and uses the custom chat transport,
// making a nice reusable hook for chat functionality.
export function useChat(
  options?: CustomChatOptions
) {
  const transportRef = useRef<ReturnType<typeof createChatTransport> | undefined>(undefined)
  const {
    sessionId,
    sessionTitle,
    systemMessage,
    inferenceParameters: rawInferenceParameters = {},
    modelOverrideId,
    activeTeamId,
    onTokenUsage,
    onCostApproval,
    ...chatInitOptions
  } = options ?? {}
  // Stabilize inferenceParameters: update the ref only when content changes,
  // so effects that depend on it do not fire on referential re-renders.
  const inferenceParametersRef = useRef(rawInferenceParameters)
  const inferenceParametersJsonRef = useRef('')
  const currentJson = JSON.stringify(rawInferenceParameters)
  if (currentJson !== inferenceParametersJsonRef.current) {
    inferenceParametersJsonRef.current = currentJson
    inferenceParametersRef.current = rawInferenceParameters
  }
  const inferenceParameters = inferenceParametersRef.current
  const ensureSession = useChatSessions((state) => state.ensureSession)
  const setSessionTitle = useChatSessions((state) => state.setSessionTitle)
  const updateStatus = useChatSessions((state) => state.updateStatus)

  // Get serviceHub and model metadata from app state
  const mcpToolNames = useAppState((state) => state.mcpToolNames)


  const existingSessionTransport = sessionId
    ? useChatSessions.getState().sessions[sessionId]?.transport
    : undefined

  // Create transport immediately; reuse existing session transport if present.
  if (!transportRef.current) {
    transportRef.current =
      existingSessionTransport ??
      createChatTransport({ systemMessage, sessionId, inferenceParameters, modelOverrideId })
  } else if (
    existingSessionTransport &&
    transportRef.current !== existingSessionTransport
  ) {
    transportRef.current = existingSessionTransport
  }

  useEffect(() => {
    if (transportRef.current) {
      transportRef.current.updateSystemMessage(systemMessage)
    }
  }, [systemMessage])

  useEffect(() => {
    if (transportRef.current) {
      transportRef.current.updateInferenceParameters(inferenceParameters)
    }
  }, [inferenceParameters])

  useEffect(() => {
    if (transportRef.current) {
      transportRef.current.updateModelOverrideId(modelOverrideId)
    }
  }, [modelOverrideId])

  useEffect(() => {
    if (transportRef.current) {
      transportRef.current.updateActiveTeamId(activeTeamId)
    }
  }, [activeTeamId])

  useEffect(() => {
    if (transportRef.current) {
      transportRef.current.setCostApprovalCallback(onCostApproval)
    }
  }, [onCostApproval])

  // Set up streaming token speed callback to update global state
  const resetTokenSpeed = useAppState((state) => state.resetTokenSpeed)

  // Update the token usage callback when it changes
  useEffect(() => {
    if (transportRef.current) {
      transportRef.current.setOnTokenUsage(onTokenUsage)
    }
  }, [onTokenUsage])

  // Keep chatInitOptions in a ref so the Chat factory always uses the latest
  // callbacks without making them useMemo dependencies (which would recreate
  // the session on every prop change).
  const chatInitOptionsRef = useRef(chatInitOptions)
  chatInitOptionsRef.current = chatInitOptions

  // ensureSession is idempotent for existing sessions — calling it again with
  // a changed sessionTitle just updates the title without recreating the Chat.
  const chat = useMemo(() => {
    if (!sessionId || !transportRef.current) return undefined

    return ensureSession(
      sessionId,
      transportRef.current,
      () => new Chat({ ...chatInitOptionsRef.current, transport: transportRef.current }),
      sessionTitle
    )
  }, [sessionId, ensureSession, sessionTitle])

  useEffect(() => {
    if (sessionId && sessionTitle) {
      setSessionTitle(sessionId, sessionTitle)
    }
  }, [sessionId, sessionTitle, setSessionTitle])

  const chatResult = useChatSDK({
    ...(chat
      ? { chat }
      : { transport: transportRef.current, ...chatInitOptions }),
    experimental_throttle: options?.experimental_throttle,
    resume: false,
    dataPartSchemas: {
      agentStatus: z.object({
        agent_id: z.string(),
        agent_name: z.string(),
        agent_role: z.string().optional(),
        status: z.enum(['running', 'complete', 'error']),
        tokens_used: z.number(),
        tool_calls: z
          .array(z.object({ name: z.string(), args: z.unknown() }))
          .optional(),
        error: z.string().optional(),
      }),
      agentToolCall: z.object({
        agent_id: z.string(),
        tool_name: z.string(),
        args: z.unknown(),
        result: z.string().optional(),
        status: z.enum(['calling', 'complete', 'error']),
      }),
      runLog: z.object({
        id: z.string(),
        team_id: z.string(),
        thread_id: z.string(),
        status: z.enum(['running', 'completed', 'failed']),
        steps: z.array(z.object({
          agent_id: z.string(),
          agent_name: z.string(),
          agent_role: z.string().optional(),
          tokens_used: z.number(),
          duration_ms: z.number(),
          status: z.enum(['complete', 'error']),
          error: z.string().optional(),
          tool_calls: z.array(z.object({ name: z.string(), args: z.unknown() })).optional(),
        })),
        total_tokens: z.number(),
        orchestrator_tokens: z.number(),
        started_at: z.number(),
        completed_at: z.number().optional(),
        error: z.string().optional(),
      }),
    },
  })

  useEffect(() => {
    if (sessionId) {
      updateStatus(sessionId, chatResult.status)
    }
  }, [sessionId, chatResult.status, updateStatus])

  // Reset token speed when streaming stops
  useEffect(() => {
    if (chatResult.status !== 'streaming') {
      resetTokenSpeed()
    }
  }, [chatResult.status, resetTokenSpeed])

  // Refresh tools when MCP or RAG tool names change (e.g., when MCP servers start/stop)
  useEffect(() => {
    if (transportRef.current) {
      // Use forceRefreshTools to update the transport's tool cache
      // This ensures the transport has the latest tools when MCP server status changes
      transportRef.current.refreshTools()
    }
  }, [mcpToolNames])

  // Expose method to update RAG tools availability
  const updateRagToolsAvailability = useCallback(
    async (
      hasDocuments: boolean,
      modelSupportsTools: boolean,
      ragFeatureAvailable: boolean
    ) => {
      if (transportRef.current) {
        await transportRef.current.updateRagToolsAvailability(
          hasDocuments,
          modelSupportsTools,
          ragFeatureAvailable
        )
      }
    },
    []
  )

  return {
    ...chatResult,
    updateRagToolsAvailability,
  }
}
