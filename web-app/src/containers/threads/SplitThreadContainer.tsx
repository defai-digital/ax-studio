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
import { type ThreadMessage } from '@ax-studio/core'
import { useChat } from '@/hooks/chat/use-chat'
import { useThreadConfig } from '@/hooks/threads/use-thread-config'
import { useThreadChat } from '@/hooks/threads/use-thread-chat'
import { useThreadTools, type AddToolOutputFn } from '@/hooks/threads/use-thread-tools'
import { extractContentPartsFromUIMessage } from '@/lib/messages'
import {
  CODE_EXECUTION_INSTRUCTION,
  LOCAL_KNOWLEDGE_INSTRUCTION,
  CITATION_FORMAT_INSTRUCTION,
} from '@/lib/prompts/system-prompt'
import { MainThreadPane } from '@/containers/threads/MainThreadPane'

export function SplitThreadContainer({
  threadId,
  onClose,
  hideComposer = false,
  headerBadge,
  registerSend,
  onBusyChange,
}: {
  threadId: string
  onClose: () => void
  /** Compare mode: hide the per-pane composer (a shared composer is used). */
  hideComposer?: boolean
  /** Small muted badge in the pane header (e.g. the pane's model id). */
  headerBadge?: string
  /**
   * Compare mode: exposes this pane's submit handler so a shared composer can
   * dispatch the same prompt to both threads via the existing send path.
   * Called with null on unmount.
   */
  registerSend?: (send: ((text: string) => Promise<void>) | null) => void
  /** Compare mode: reports whether this pane is generating. */
  onBusyChange?: (busy: boolean) => void
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
  const { promptResolution, optimizedModelConfig } = useThreadConfig({
    thread,
    selectedModel,
    globalDefaultPrompt,
    autoTuningEnabled,
    threadMessageCount,
  })
  const {
    followUpMessage,
    onToolCall,
    startToolExecution,
    resetTurnState,
  } = useThreadTools({ threadId, projectId })

  // ─── UI state ─────────────────────────────────────────────────────────────
  const [threadPromptDraft, setThreadPromptDraft] = useState('')
  const [showThreadPromptEditor, setShowThreadPromptEditor] = useState(false)
  const reasoningContainerRef = useRef<HTMLDivElement>(null)

  // ─── Chat session ─────────────────────────────────────────────────────────
  // Ref breaks the useChat <-> useThreadChat circular dependency (same pattern as $threadId.tsx)
  const persistMessageOnFinishRef = useRef<
    ((msg: UIMessage, parts: ThreadMessage['content']) => void) | null
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
      (currentAssistant?.instructions && currentAssistant.id !== 'ax-studio'
        ? '\n\n' + currentAssistant.instructions
        : '') +
      CODE_EXECUTION_INSTRUCTION +
      (localKnowledgeActive ? LOCAL_KNOWLEDGE_INSTRUCTION : '') +
      (localKnowledgeActive ? CITATION_FORMAT_INSTRUCTION : ''),
    modelOverrideId: optimizedModelConfig.modelId,
    // Bind the pane to the thread's own provider (same as $threadId.tsx) so
    // compare mode can pin each pane to a model from a different provider.
    modelOverrideProviderId: thread?.model?.provider,
    inferenceParameters: {
      temperature: optimizedModelConfig.temperature,
      top_p: optimizedModelConfig.top_p,
      max_output_tokens: optimizedModelConfig.max_output_tokens,
    },
    experimental_throttle: 50,
    onFinish: ({ message, isAbort }) => {
      if (message.role === 'assistant') {
        const routerResult = getLastRouterResult()
        const routingMeta = routerResult?.routed
          ? {
            modelId: routerResult.modelId,
            providerId: routerResult.providerId,
            reason: routerResult.reason,
            routed: true,
            latencyMs: routerResult.latencyMs,
          }
          : undefined
        const hasMetadataUpdate = isAbort || Boolean(routingMeta)
        const messageForPersistence = hasMetadataUpdate
          ? {
              ...message,
              metadata: {
                ...((message.metadata ?? {}) as Record<string, unknown>),
                ...(isAbort ? { aborted: true } : {}),
                ...(routingMeta ? { routing: routingMeta } : {}),
              },
            }
          : message

        if (hasMetadataUpdate) {
          const persistedMetadata = messageForPersistence.metadata
          setChatMessages((prev) =>
            prev.map((m) =>
              m.id === message.id
                ? { ...m, metadata: persistedMetadata }
                : m
            )
          )
        }
        const contentParts =
          extractContentPartsFromUIMessage(messageForPersistence)
        persistMessageOnFinishRef.current?.(messageForPersistence, contentParts)
      }
      if (!isAbort) {
        startToolExecution(addToolOutput as unknown as AddToolOutputFn)
      }
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
    handleSwitchVersion,
    handleContextSizeIncrease,
  } = useThreadChat({
    threadId,
    sendMessage,
    regenerate,
    setChatMessages,
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
      resetTurnState()
      await processAndSendMessage(text)
    },
    [processAndSendMessage, resetTurnState],
  )

  // ─── Compare-mode wiring ──────────────────────────────────────────────────
  // Expose this pane's send path to the shared composer. The registered
  // handler is exactly the same one the pane's own composer uses, so a
  // compare send is two independent calls through the existing per-thread
  // pipeline (no new message format).
  useEffect(() => {
    if (!registerSend) return
    registerSend(handleSubmit)
    return () => registerSend(null)
  }, [registerSend, handleSubmit])

  useEffect(() => {
    onBusyChange?.(status === 'submitted' || status === 'streaming')
  }, [onBusyChange, status])

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
        handleSwitchVersion={handleSwitchVersion}
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
        hideComposer={hideComposer}
        headerBadge={headerBadge}
      />
    </div>
  )
}
