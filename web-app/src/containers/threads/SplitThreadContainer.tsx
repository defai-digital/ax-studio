/**
 * SplitThreadContainer — data-layer wrapper for the split pane.
 *
 * Reuses the same extracted hooks as the main ThreadDetail route ($threadId.tsx),
 * then delegates all rendering to MainThreadPane with isSplitView=true.
 *
 * This ensures feature parity: editing, memory, research, animations,
 * context-size increase, local knowledge, etc. all work identically in both panes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { UIMessage } from '@ai-sdk/react'
import { useThreads } from '@/hooks/threads/useThreads'
import { useAssistant } from '@/hooks/chat/useAssistant'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { useGeneralSetting } from '@/hooks/settings/useGeneralSetting'
import { useMessages } from '@/hooks/chat/useMessages'
import { useLocalKnowledge } from '@/hooks/research/useLocalKnowledge'
import { useChat } from '@/hooks/chat/use-chat'
import { useThreadMemory } from '@/hooks/threads/use-thread-memory'
import { useThreadConfig } from '@/hooks/threads/use-thread-config'
import { useThreadChat } from '@/hooks/threads/use-thread-chat'
import { useThreadTools } from '@/hooks/threads/use-thread-tools'
import { useThreadResearch } from '@/hooks/threads/use-thread-research'
import { extractContentPartsFromUIMessage } from '@/lib/messages'
import {
  DIAGRAM_FORMAT_INSTRUCTION,
  CODE_EXECUTION_INSTRUCTION,
  ARTIFACT_FORMAT_INSTRUCTION,
  LOCAL_KNOWLEDGE_INSTRUCTION,
  CITATION_FORMAT_INSTRUCTION,
} from '@/lib/system-prompt'
import { toast } from 'sonner'
import { ResearchPanel } from '@/components/research/ResearchPanel'
import { MainThreadPane } from '@/containers/threads/MainThreadPane'

export function SplitThreadContainer({
  threadId,
  onClose,
}: {
  threadId: string
  onClose: () => void
}) {
  // ─── Store subscriptions ──────────────────────────────────────────────────
  const thread = useThreads(useShallow((state) => state.threads[threadId]))
  const updateThread = useThreads((state) => state.updateThread)
  const currentAssistant = useAssistant((state) => state.currentAssistant)
  const selectedModel = useModelProvider((state) => state.selectedModel) ?? undefined
  const { globalDefaultPrompt, autoTuningEnabled } = useGeneralSetting()
  const threadMessageCount = useMessages(
    (state) => state.messages[threadId]?.length ?? 0,
  )
  const localKnowledgeActive = useLocalKnowledge((state) =>
    state.isLocalKnowledgeEnabledForThread(threadId),
  )

  // ─── Domain hooks (same as $threadId.tsx) ─────────────────────────────────
  const projectId = thread?.metadata?.project?.id
  const {
    memorySuffix,
    lastUserInputRef,
    processMemoryOnFinish,
    handleRememberCommand,
    handleForgetCommand,
  } = useThreadMemory(threadId)
  const { promptResolution, optimizedModelConfig } = useThreadConfig({
    thread,
    selectedModel,
    globalDefaultPrompt,
    autoTuningEnabled,
    threadMessageCount,
  })
  const { pinnedResearch, clearResearch, handleResearchCommand } =
    useThreadResearch(threadId)
  const {
    followUpMessage,
    onToolCall,
    startToolExecution,
    onCostApproval,
    agentTeams,
    activeTeamId,
    activeTeam,
    handleTeamChange,
  } = useThreadTools({ threadId, projectId })

  // ─── UI state ─────────────────────────────────────────────────────────────
  const [threadPromptDraft, setThreadPromptDraft] = useState('')
  const [showThreadPromptEditor, setShowThreadPromptEditor] = useState(false)
  const reasoningContainerRef = useRef<HTMLDivElement>(null)

  // ─── Chat session ─────────────────────────────────────────────────────────
  // Ref breaks the useChat <-> useThreadChat circular dependency (same pattern as $threadId.tsx)
  const persistMessageOnFinishRef = useRef<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((msg: UIMessage, parts: any[]) => void) | null
  >(null)

  const {
    messages: chatMessages,
    status,
    error,
    sendMessage,
    regenerate,
    setMessages: setChatMessages,
    stop,
    addToolOutput,
    getLastRouterResult,
  } = useChat({
    sessionId: threadId,
    sessionTitle: thread?.title,
    systemMessage:
      promptResolution.resolvedPrompt +
      (currentAssistant?.instructions
        ? '\n\n' + currentAssistant.instructions
        : '') +
      memorySuffix +
      DIAGRAM_FORMAT_INSTRUCTION +
      CODE_EXECUTION_INSTRUCTION +
      ARTIFACT_FORMAT_INSTRUCTION +
      (localKnowledgeActive ? LOCAL_KNOWLEDGE_INSTRUCTION : '') +
      (localKnowledgeActive ? CITATION_FORMAT_INSTRUCTION : ''),
    modelOverrideId: optimizedModelConfig.modelId,
    activeTeamId,
    onCostApproval,
    inferenceParameters: {
      temperature: optimizedModelConfig.temperature,
      top_p: optimizedModelConfig.top_p,
      max_output_tokens: optimizedModelConfig.max_output_tokens,
    },
    experimental_throttle: 50,
    onFinish: ({ message, isAbort }) => {
      if (!isAbort && message.role === 'assistant') {
        // Attach routing metadata if the LLM router made a decision. Mirrors
        // the behaviour of $threadId.tsx so split-thread mode also persists
        // and renders the routing badge. The enriched copy is built
        // immutably (no mutation of the AI SDK message object) and is used
        // for both persistence and memory processing so the badge survives
        // a reload.
        const routerResult = getLastRouterResult()
        let messageForPersistence = message
        if (routerResult?.routed) {
          const routingMeta = {
            modelId: routerResult.modelId,
            providerId: routerResult.providerId,
            reason: routerResult.reason,
            routed: true,
            latencyMs: routerResult.latencyMs,
          }
          messageForPersistence = {
            ...message,
            metadata: {
              ...((message.metadata ?? {}) as Record<string, unknown>),
              routing: routingMeta,
            },
          }
          setChatMessages((prev) =>
            prev.map((m) =>
              m.id === message.id
                ? {
                    ...m,
                    metadata: {
                      ...((m.metadata ?? {}) as Record<string, unknown>),
                      routing: routingMeta,
                    },
                  }
                : m,
            ),
          )
        }
        const contentParts =
          extractContentPartsFromUIMessage(messageForPersistence)
        processMemoryOnFinish(
          messageForPersistence,
          contentParts,
          setChatMessages,
        )
        persistMessageOnFinishRef.current?.(messageForPersistence, contentParts)
      }
      startToolExecution(addToolOutput)
    },
    onToolCall,
    sendAutomaticallyWhen: followUpMessage,
  })

  const {
    processAndSendMessage,
    persistMessageOnFinish,
    handleRegenerate,
    handleEditMessage,
    handleDeleteMessage,
    handleContextSizeIncrease,
  } = useThreadChat({
    threadId,
    sendMessage,
    regenerate,
    chatMessages,
    setChatMessages,
    handleRememberCommand,
    handleForgetCommand,
    lastUserInputRef,
  })

  persistMessageOnFinishRef.current = persistMessageOnFinish

  // ─── Effects (subset relevant to split pane) ─────────────────────────────
  // Sync thread prompt draft when stored prompt changes
  useEffect(() => {
    setThreadPromptDraft(
      typeof thread?.metadata?.threadPrompt === 'string'
        ? thread.metadata.threadPrompt
        : '',
    )
  }, [thread?.metadata?.threadPrompt])

  // Reasoning container auto-scroll during streaming
  useEffect(() => {
    if (status !== 'streaming' || !reasoningContainerRef.current) return
    const el = reasoningContainerRef.current
    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(raf)
  }, [status, chatMessages])

  // ─── Submit handler ───────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (text: string) => {
      if (handleResearchCommand(text)) return
      try {
        await processAndSendMessage(text)
      } catch (error) {
        console.error('Failed to submit split thread message:', error)
        toast.error('Failed to send message', {
          description: error instanceof Error ? error.message : 'Please try again.',
        })
      }
    },
    [processAndSendMessage, handleResearchCommand],
  )

  // ─── Derived values ──────────────────────────────────────────────────────
  const threadModel = useMemo(() => thread?.model, [thread])
  const threadLogo = useMemo(() => {
    const chatLogo =
      typeof thread?.metadata?.chatLogo === 'string'
        ? thread.metadata.chatLogo.trim()
        : ''
    if (chatLogo) return chatLogo
    const projectLogo =
      typeof thread?.metadata?.project?.logo === 'string'
        ? thread.metadata.project.logo.trim()
        : ''
    return projectLogo || ''
  }, [thread?.metadata])

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="relative h-full">
      {pinnedResearch && (
        <div className="absolute inset-0 z-10 flex flex-col bg-background rounded-md border overflow-hidden">
          <ResearchPanel
            threadId={threadId}
            onClose={() => clearResearch(threadId)}
          />
        </div>
      )}
      <MainThreadPane
        threadId={threadId}
        thread={thread}
        threadLogo={threadLogo}
        chatMessages={chatMessages}
        status={status}
        error={error}
        stop={stop}
        threadModel={threadModel}
        handleSubmit={handleSubmit}
        handleRegenerate={handleRegenerate}
        handleEditMessage={handleEditMessage}
        handleDeleteMessage={handleDeleteMessage}
        handleContextSizeIncrease={handleContextSizeIncrease}
        reasoningContainerRef={reasoningContainerRef}
        showThreadPromptEditor={showThreadPromptEditor}
        setShowThreadPromptEditor={setShowThreadPromptEditor}
        threadPromptDraft={threadPromptDraft}
        setThreadPromptDraft={setThreadPromptDraft}
        promptResolution={promptResolution}
        updateThread={updateThread}
        isSplitView
        onSplitClose={onClose}
        agentTeams={agentTeams}
        activeTeamId={activeTeamId}
        activeTeam={activeTeam}
        handleTeamChange={handleTeamChange}
      />
    </div>
  )
}
