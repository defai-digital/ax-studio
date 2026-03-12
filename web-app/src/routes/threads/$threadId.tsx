import { useCallback, useMemo, useRef, useState } from 'react'
import { createFileRoute, useParams } from '@tanstack/react-router'
import { useThreads } from '@/hooks/useThreads'
import { useShallow } from 'zustand/react/shallow'
import { useAssistant } from '@/hooks/useAssistant'
import { useTools } from '@/hooks/useTools'
import { useChat } from '@/hooks/use-chat'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useMessages } from '@/hooks/useMessages'

import { extractContentPartsFromUIMessage } from '@/lib/messages'
import {
  DIAGRAM_FORMAT_INSTRUCTION,
  CODE_EXECUTION_INSTRUCTION,
  ARTIFACT_FORMAT_INSTRUCTION,
} from '@/lib/system-prompt'
import type { UIMessage } from '@ai-sdk/react'
import { useThreadMemory } from '@/hooks/thread/use-thread-memory'
import { useThreadArtifacts } from '@/hooks/thread/use-thread-artifacts'
import { useThreadResearch } from '@/hooks/thread/use-thread-research'
import { useThreadChat } from '@/hooks/thread/use-thread-chat'
import { useThreadTools } from '@/hooks/thread/use-thread-tools'
import { useThreadSplit } from '@/hooks/thread/use-thread-split'
import { useThreadConfig } from '@/hooks/thread/use-thread-config'
import { useThreadEffects } from '@/hooks/thread/use-thread-effects'
import { ThreadView } from '@/routes/threads/ThreadView'

export const Route = createFileRoute('/threads/$threadId')({
  component: ThreadDetail,
})

function ThreadDetail() {
  const { threadId } = useParams({ from: Route.id })

  // ─── Store subscriptions ──────────────────────────────────────────────────
  const updateThread = useThreads((state) => state.updateThread)
  const setCurrentThreadId = useThreads((state) => state.setCurrentThreadId)
  const setCurrentAssistant = useAssistant((state) => state.setCurrentAssistant)
  const assistants = useAssistant((state) => state.assistants)
  useTools()

  const thread = useThreads(useShallow((state) => state.threads[threadId]))
  const selectedModel = useModelProvider((state) => state.selectedModel)
  const selectedProvider = useModelProvider((state) => state.selectedProvider)
  const { globalDefaultPrompt, autoTuningEnabled } = useGeneralSetting()
  const threadMessageCount = useMessages((state) => state.messages[threadId]?.length ?? 0)

  // ─── Domain hooks ─────────────────────────────────────────────────────────
  const { memorySuffix, lastUserInputRef, processMemoryOnFinish, handleRememberCommand, handleForgetCommand } =
    useThreadMemory(threadId)
  const projectId = thread?.metadata?.project?.id
  const { pinnedArtifact, clearArtifact } = useThreadArtifacts(threadId)
  const { pinnedResearch, clearResearch, handleResearchCommand } = useThreadResearch(threadId)
  const { promptResolution, optimizedModelConfig } = useThreadConfig({
    thread, selectedModel, globalDefaultPrompt, autoTuningEnabled, threadMessageCount,
  })
  const {
    followUpMessage, onToolCall, startToolExecution, onCostApproval,
    costApprovalState, setCostApprovalState,
    agentTeams, activeTeamId, activeTeam, activeTeamSnapshot,
    showVariablePrompt, setShowVariablePrompt, teamTokensUsed, setTeamTokensUsed,
    handleVariableSubmit, handleTeamChange,
  } = useThreadTools({ threadId, projectId })
  const { splitPaneOrder, splitThreadId, setSplitThreadId, setSplitDirection, handleSplit } =
    useThreadSplit({ thread, selectedModel, selectedProvider })

  // ─── UI state ─────────────────────────────────────────────────────────────
  const [threadPromptDraft, setThreadPromptDraft] = useState('')
  const [showThreadPromptEditor, setShowThreadPromptEditor] = useState(false)
  const [showPromptDebug, setShowPromptDebug] = useState(false)

  // ─── Chat session ─────────────────────────────────────────────────────────
  // Ref holds persistMessageOnFinish to break the useChat ↔ useThreadChat circular dep
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const persistMessageOnFinishRef = useRef<((msg: UIMessage, parts: any[]) => void) | null>(null)

  const {
    messages: chatMessages, status, error, sendMessage, regenerate,
    setMessages: setChatMessages, stop, addToolOutput,
  } = useChat({
    sessionId: threadId,
    sessionTitle: thread?.title,
    systemMessage: promptResolution.resolvedPrompt + memorySuffix + DIAGRAM_FORMAT_INSTRUCTION + CODE_EXECUTION_INSTRUCTION + ARTIFACT_FORMAT_INSTRUCTION,
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
        const contentParts = extractContentPartsFromUIMessage(message)
        processMemoryOnFinish(message, contentParts, setChatMessages)
        persistMessageOnFinishRef.current?.(message, contentParts)
      }
      startToolExecution(addToolOutput)
    },
    onToolCall,
    sendAutomaticallyWhen: followUpMessage,
  })

  const { processAndSendMessage, persistMessageOnFinish, handleRegenerate, handleEditMessage, handleDeleteMessage, handleContextSizeIncrease } =
    useThreadChat({ threadId, sendMessage, regenerate, chatMessages, setChatMessages, handleRememberCommand, handleForgetCommand, lastUserInputRef })

  persistMessageOnFinishRef.current = persistMessageOnFinish

  const reasoningContainerRef = useRef<HTMLDivElement>(null)

  // ─── Effects ──────────────────────────────────────────────────────────────
  useThreadEffects({
    threadId, thread, chatMessages, status, assistants, selectedModel,
    activeTeamId, setTeamTokensUsed,
    reasoningContainerRef, setCurrentThreadId, setCurrentAssistant,
    processAndSendMessage, handleResearchCommand, updateThread, setThreadPromptDraft,
  })

  // ─── Submit handler ───────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (text: string) => {
      if (handleResearchCommand(text)) return
      await processAndSendMessage(text)
    },
    [processAndSendMessage, handleResearchCommand]
  )

  const threadModel = useMemo(() => thread?.model, [thread])
  const threadLogo = useMemo(() => {
    const chatLogo = typeof thread?.metadata?.chatLogo === 'string' ? thread.metadata.chatLogo.trim() : ''
    if (chatLogo) return chatLogo
    const projectLogo = typeof thread?.metadata?.project?.logo === 'string' ? thread.metadata.project.logo.trim() : ''
    return projectLogo || ''
  }, [thread?.metadata])

  return (
    <ThreadView
      threadId={threadId}
      thread={thread}
      threadModel={threadModel}
      threadLogo={threadLogo}
      chatMessages={chatMessages}
      status={status}
      error={error}
      stop={stop}
      handleSubmit={handleSubmit}
      handleRegenerate={handleRegenerate}
      handleEditMessage={handleEditMessage}
      handleDeleteMessage={handleDeleteMessage}
      handleContextSizeIncrease={handleContextSizeIncrease}
      reasoningContainerRef={reasoningContainerRef}
      pinnedArtifact={pinnedArtifact}
      clearArtifact={clearArtifact}
      pinnedResearch={pinnedResearch}
      clearResearch={clearResearch}
      splitPaneOrder={splitPaneOrder}
      splitThreadId={splitThreadId}
      setSplitThreadId={setSplitThreadId}
      setSplitDirection={setSplitDirection}
      handleSplit={handleSplit}
      showThreadPromptEditor={showThreadPromptEditor}
      setShowThreadPromptEditor={setShowThreadPromptEditor}
      threadPromptDraft={threadPromptDraft}
      setThreadPromptDraft={setThreadPromptDraft}
      showPromptDebug={showPromptDebug}
      setShowPromptDebug={setShowPromptDebug}
      promptResolution={promptResolution}
      optimizedModelConfig={optimizedModelConfig}
      autoTuningEnabled={autoTuningEnabled}
      updateThread={updateThread}
      activeTeam={activeTeam}
      activeTeamId={activeTeamId}
      activeTeamSnapshot={activeTeamSnapshot}
      agentTeams={agentTeams}
      handleTeamChange={handleTeamChange}
      teamTokensUsed={teamTokensUsed}
      costApprovalState={costApprovalState}
      setCostApprovalState={setCostApprovalState}
      showVariablePrompt={showVariablePrompt}
      setShowVariablePrompt={setShowVariablePrompt}
      handleVariableSubmit={handleVariableSubmit}
    />
  )
}
