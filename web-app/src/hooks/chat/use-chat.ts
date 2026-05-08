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
import { useEffect, useMemo, useRef, useCallback } from 'react'
import { useChatSessions } from '@/stores/chat-session-store'
import { useAppState } from '@/hooks/settings/useAppState'
import { useLocalKnowledge } from '@/hooks/research/useLocalKnowledge'

type CustomChatOptions = Omit<ChatInit<UIMessage>, 'transport'> &
  Pick<UseChatOptions<UIMessage>, 'experimental_throttle' | 'resume'> & {
    sessionId?: string
    sessionTitle?: string
    systemMessage?: string
    inferenceParameters?: Record<string, unknown>
    modelOverrideId?: string
    modelOverrideProviderId?: string
    onTokenUsage?: (usage: LanguageModelUsage, messageId: string) => void
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
    modelOverrideProviderId,
    onTokenUsage,
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

  // Subscribe to local knowledge toggle — refresh tools when it changes
  const localKnowledgeEnabled = useLocalKnowledge((state) =>
    sessionId ? state.isLocalKnowledgeEnabledForThread(sessionId) : state.localKnowledgeEnabled
  )


  const existingSessionTransport = sessionId
    ? useChatSessions.getState().sessions[sessionId]?.transport
    : undefined

  // Create transport immediately; reuse existing session transport if present.
  if (!transportRef.current) {
    transportRef.current =
      existingSessionTransport ??
      createChatTransport({
        systemMessage,
        sessionId,
        inferenceParameters,
        modelOverrideId,
        modelOverrideProviderId,
      })
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
      transportRef.current.updateModelOverrideProviderId(modelOverrideProviderId)
    }
  }, [modelOverrideProviderId])

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

  // Extract tool-related callbacks so they are always forwarded to the SDK hook,
  // regardless of whether we provide a Chat instance or raw transport+options.
  // The Chat instance stores the initial callbacks, but the hook needs them too
  // so it can orchestrate the full tool-call lifecycle (sendAutomaticallyWhen, etc.).
  const { onToolCall, onFinish, sendAutomaticallyWhen } = chatInitOptions

  const chatResult = useChatSDK({
    ...(chat
      ? { chat, onToolCall, onFinish, sendAutomaticallyWhen }
      : { transport: transportRef.current, ...chatInitOptions }),
    experimental_throttle: options?.experimental_throttle,
    resume: false,
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

  useEffect(() => {
    if (transportRef.current) {
      transportRef.current.refreshTools()
    }
  }, [mcpToolNames, localKnowledgeEnabled])

  // Expose method to push a system message directly to the transport (bypasses React render cycle)
  const updateSystemMessageDirect = useCallback((msg: string | undefined) => {
    transportRef.current?.updateSystemMessage(msg)
  }, [])

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

  const getLastRouterResult = useCallback(() => {
    return transportRef.current?.lastRouterResult ?? null
  }, [])

  return {
    ...chatResult,
    updateRagToolsAvailability,
    updateSystemMessageDirect,
    getLastRouterResult,
  }
}
