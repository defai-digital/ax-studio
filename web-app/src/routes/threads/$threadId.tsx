import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

import HeaderPage from '@/containers/HeaderPage'
import { useThreads } from '@/hooks/useThreads'
import ChatInput from '@/containers/ChatInput'
import { useShallow } from 'zustand/react/shallow'
import { MessageItem } from '@/containers/MessageItem'

import { useMessages } from '@/hooks/useMessages'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useAssistant } from '@/hooks/useAssistant'
import { useTools } from '@/hooks/useTools'
import { useAppState } from '@/hooks/useAppState'
import { SESSION_STORAGE_PREFIX, SESSION_STORAGE_KEY } from '@/constants/chat'
import { useChat } from '@/hooks/use-chat'
import { useModelProvider } from '@/hooks/useModelProvider'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { generateId, lastAssistantMessageIsCompleteWithToolCalls } from 'ai'
import type { UIMessage } from '@ai-sdk/react'
import { useChatSessions } from '@/stores/chat-session-store'
import {
  convertThreadMessagesToUIMessages,
  extractContentPartsFromUIMessage,
} from '@/lib/messages'
import { newUserThreadContent } from '@/lib/completion'
import {
  ThreadMessage,
  MessageStatus,
  ChatCompletionRole,
  ContentType,
} from '@ax-fabric/core'
import { createImageAttachment } from '@/types/attachment'
import {
  useChatAttachments,
  NEW_THREAD_ATTACHMENT_KEY,
} from '@/hooks/useChatAttachments'
import { processAttachmentsForSend } from '@/lib/attachmentProcessing'
import { useAttachments } from '@/hooks/useAttachments'
import { PromptProgress } from '@/components/PromptProgress'
import { useToolAvailable } from '@/hooks/useToolAvailable'
import { OUT_OF_CONTEXT_SIZE } from '@/utils/error'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { IconAlertCircle } from '@tabler/icons-react'
import { useToolApproval } from '@/hooks/useToolApproval'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
import { ExtensionTypeEnum, VectorDBExtension } from '@ax-fabric/core'
import { ExtensionManager } from '@/lib/extension'
import { Columns2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useMemory } from '@/hooks/useMemory'
import {
  parseMemoryDelta,
  applyMemoryDelta,
  buildMemoryContext,
  extractFactsFromPatterns,
  mergePatternFacts,
  type MemoryDeltaOp,
} from '@/lib/memory-extractor'
import {
  getOptimizedModelConfig,
  resolveSystemPrompt,
  DIAGRAM_FORMAT_INSTRUCTION,
  CODE_EXECUTION_INSTRUCTION,
  ARTIFACT_FORMAT_INSTRUCTION,
} from '@/lib/system-prompt'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ArtifactPanel } from '@/components/ai-elements/ArtifactPanel'
import { useArtifactPanel } from '@/hooks/useArtifactPanel'
import { ResearchPanel } from '@/components/research/ResearchPanel'
import { useResearchPanel } from '@/hooks/useResearchPanel'
import { useResearch } from '@/hooks/useResearch'

/** Parse /research[:mode] prefix into a depth number (2=Standard, 3=Deep). */
function parseResearchDepth(afterCommand: string): 2 | 3 {
  return /^:(deep|3)\b/i.test(afterCommand) ? 3 : 2
}

const CHAT_STATUS = {
  STREAMING: 'streaming',
  SUBMITTED: 'submitted',
} as const

function SplitThreadPane({
  threadId,
  onClose,
}: {
  threadId: string
  onClose?: () => void
}) {
  const serviceHub = useServiceHub()
  const thread = useThreads(useShallow((state) => state.threads[threadId]))
  const splitPinnedResearch = useResearchPanel((s) => s.getPinned(threadId))
  const clearResearch = useResearchPanel((s) => s.clearResearch)
  const { startResearch } = useResearch(threadId)
  const renameThread = useThreads((state) => state.renameThread)
  const updateThread = useThreads((state) => state.updateThread)
  const setMessages = useMessages((state) => state.setMessages)
  const addMessage = useMessages((state) => state.addMessage)
  const updateMessage = useMessages((state) => state.updateMessage)
  const deleteMessage = useMessages((state) => state.deleteMessage)
  const getAttachments = useChatAttachments((state) => state.getAttachments)
  const clearAttachmentsForThread = useChatAttachments(
    (state) => state.clearAttachments
  )
  const selectedProvider = useModelProvider((state) => state.selectedProvider)
  const selectedModel = useModelProvider((state) => state.selectedModel)
  const { globalDefaultPrompt, autoTuningEnabled } = useGeneralSetting()
  const memoryEnabled = useMemory((state) => state.memoryEnabled)
  const memoryVersion = useMemory((state) => state.memoryVersion)
  const messageCount = useMessages(
    (state) => state.messages[threadId]?.length ?? 0
  )
  const [showThreadPromptEditor, setShowThreadPromptEditor] = useState(false)
  const [threadPromptDraft, setThreadPromptDraft] = useState('')
  const reasoningContainerRef = useRef<HTMLDivElement>(null)
  const processedMemoryMsgIds = useRef(new Set<string>())
  const lastUserInputRef = useRef('')
  const paneLogo = useMemo(() => {
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

  const memorySuffix = useMemo(() => {
    if (!memoryEnabled) return ''
    const memories = useMemory.getState().getMemories('default')
    return buildMemoryContext(memories)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoryEnabled, memoryVersion])

  const promptResolution = useMemo(
    () =>
      resolveSystemPrompt(
        thread?.metadata?.threadPrompt,
        thread?.metadata?.project?.projectPrompt,
        { globalDefaultPrompt }
      ),
    [
      globalDefaultPrompt,
      thread?.metadata?.project?.projectPrompt,
      thread?.metadata?.threadPrompt,
    ]
  )

  const optimizedModelConfig = useMemo(() => {
    const baseConfig = {
      temperature:
        thread?.assistants?.[0]?.parameters?.temperature as number | undefined,
      top_p: thread?.assistants?.[0]?.parameters?.top_p as number | undefined,
      max_output_tokens:
        thread?.assistants?.[0]?.parameters?.max_output_tokens as
          | number
          | undefined,
      modelId: selectedModel?.id,
    }
    if (!autoTuningEnabled) return baseConfig
    return getOptimizedModelConfig(
      {
        promptLength: promptResolution.resolvedPrompt.length,
        messageCount,
        hasAttachments: Boolean(thread?.metadata?.hasDocuments),
        modelCapabilities: selectedModel?.capabilities,
      },
      baseConfig
    )
  }, [
    autoTuningEnabled,
    messageCount,
    promptResolution.resolvedPrompt.length,
    selectedModel?.id,
    selectedModel?.capabilities,
    thread?.assistants,
    thread?.metadata?.hasDocuments,
  ])

  const {
    messages,
    status,
    sendMessage,
    stop,
    error,
    setMessages: setChatMessages,
    regenerate,
  } = useChat({
    sessionId: threadId,
    sessionTitle: thread?.title,
    systemMessage: promptResolution.resolvedPrompt + memorySuffix + DIAGRAM_FORMAT_INSTRUCTION + CODE_EXECUTION_INSTRUCTION + ARTIFACT_FORMAT_INSTRUCTION,
    modelOverrideId: optimizedModelConfig.modelId,
    inferenceParameters: {
      temperature: optimizedModelConfig.temperature,
      top_p: optimizedModelConfig.top_p,
      max_output_tokens: optimizedModelConfig.max_output_tokens,
    },
    experimental_throttle: 50,
    onFinish: ({ message, isAbort }) => {
      if (!isAbort && message.role === 'assistant') {
        const contentParts = extractContentPartsFromUIMessage(message)

        // Guard: use ref-based dedup — store-based check is unreliable (timing issues)
        const isNewMessage = !processedMemoryMsgIds.current.has(message.id)
        if (isNewMessage) processedMemoryMsgIds.current.add(message.id)

        // Strip memory tags + collect LLM ops from all content parts
        const allOps: MemoryDeltaOp[] = []
        for (const part of contentParts) {
          if (part.type === 'text' && part.text?.value) {
            const { ops, cleanedText } = parseMemoryDelta(part.text.value)
            part.text.value = cleanedText
            if (isNewMessage) allOps.push(...ops)
          }
        }

        if (isNewMessage && useMemory.getState().isMemoryEnabled() && contentParts.length > 0) {
          let toasted = false

          // Step 1: Apply LLM delta ops (surgical add/update/delete)
          if (allOps.length > 0) {
            const existing = useMemory.getState().getMemories('default')
            const updated = applyMemoryDelta(existing, allOps, threadId)
            useMemory.getState().importMemories('default', updated)
            const added = allOps.filter((o) => o.op === 'add').length
            const changed = allOps.filter((o) => o.op === 'update' || o.op === 'delete').length
            if (added > 0) {
              toast.success(`Remembered ${added} new fact${added !== 1 ? 's' : ''}`)
              toasted = true
            } else if (changed > 0) {
              toast.info('Updated memories')
              toasted = true
            }
          }

          // Step 2: Pattern fallback — use ref captured at submit time (no stale-closure issues)
          // mergePatternFacts deduplicates by category, so no duplicates from Step 1
          // Always saves to also correct wrong LLM-written facts (e.g. name="vegetarian")
          const userText = lastUserInputRef.current
          if (userText) {
            const patternFacts = extractFactsFromPatterns(userText)
            if (patternFacts.size > 0) {
              const currentMems = useMemory.getState().getMemories('default')
              const merged = mergePatternFacts(currentMems, patternFacts, threadId)
              const newlyAdded = merged.length - currentMems.length
              useMemory.getState().importMemories('default', merged)
              if (newlyAdded > 0 && !toasted) toast.success(`Remembered ${newlyAdded} new fact${newlyAdded !== 1 ? 's' : ''}`)
            }
          }
        }

        if (contentParts.length > 0) {
          const assistantMessage: ThreadMessage = {
            type: 'text',
            role: ChatCompletionRole.Assistant,
            content: contentParts,
            id: message.id,
            object: 'thread.message',
            thread_id: threadId,
            status: MessageStatus.Ready,
            created_at: Date.now(),
            completed_at: Date.now(),
            metadata: (message.metadata || {}) as Record<string, unknown>,
          }
          const existingMessages = useMessages.getState().getMessages(threadId)
          const existingMessage = existingMessages.find((m) => m.id === message.id)
          if (existingMessage) {
            updateMessage(assistantMessage)
          } else {
            addMessage(assistantMessage)
          }
        }
      }

      // Strip memory_extract tags from UI chat messages
      if (useMemory.getState().isMemoryEnabled()) {
        const sessions = useChatSessions.getState().sessions[threadId]
        if (sessions?.chat.messages) {
          const cleaned = sessions.chat.messages.map((msg) => {
            if (msg.id !== message.id || msg.role !== 'assistant') return msg
            return {
              ...msg,
              parts: msg.parts.map((part) => {
                if (part.type !== 'text') return part
                const stripped = (part as { type: 'text'; text: string }).text
                  .replace(/<memory_extract>[\s\S]*?<\/memory_extract>/, '')
                  .trimEnd()
                return { ...part, text: stripped }
              }),
            }
          })
          setChatMessages(cleaned)
        }
      }
    },
  })

  const handleRegenerate = useCallback(
    (messageId: string) => {
      regenerate({ messageId })
    },
    [regenerate]
  )

  useEffect(() => {
    setThreadPromptDraft(
      typeof thread?.metadata?.threadPrompt === 'string'
        ? thread.metadata.threadPrompt
        : ''
    )
  }, [thread?.metadata?.threadPrompt])

  useEffect(() => {
    serviceHub
      .messages()
      .fetchMessages(threadId)
      .then((fetchedMessages) => {
        if (fetchedMessages && fetchedMessages.length > 0) {
          setMessages(threadId, fetchedMessages)
          setChatMessages(convertThreadMessagesToUIMessages(fetchedMessages))
        }
      })
  }, [serviceHub, setChatMessages, setMessages, threadId])

  const handleSubmit = async (
    text: string,
    files?: Array<{ type: string; mediaType: string; url: string }>
  ) => {
    const normalizedText = text.trim()
    lastUserInputRef.current = normalizedText

    // Handle /research command
    if (normalizedText.startsWith('/research')) {
      const afterCommand = normalizedText.slice('/research'.length)
      const depth = parseResearchDepth(afterCommand)
      const query = afterCommand.replace(/^:(standard|deep|[123])?\s*/i, '').trim()
      if (query) {
        startResearch(query, depth)
        return
      }
    }

    // Handle /remember command
    if (normalizedText.startsWith('/remember ')) {
      const fact = normalizedText.slice('/remember '.length).trim()
      if (fact) {
        const now = Date.now()
        useMemory.getState().addMemories('default', [{
          id: `mem-${now}-manual`,
          fact,
          category: 'manual',
          sourceThreadId: threadId,
          createdAt: now,
          updatedAt: now,
        }])
        toast.success(`Remembered: "${fact}"`)
      }
      return
    }

    // Handle /forget command
    if (normalizedText.startsWith('/forget ')) {
      const query = normalizedText.slice('/forget '.length).trim().toLowerCase()
      if (query) {
        const memories = useMemory.getState().getMemories('default')
        const match = memories.find(m => m.fact.toLowerCase().includes(query))
        if (match) {
          useMemory.getState().deleteMemory('default', match.id)
          toast.success(`Forgot: "${match.fact}"`)
        } else {
          toast.info(`No memory found matching "${query}"`)
        }
      }
      return
    }

    if (
      normalizedText &&
      messages.length === 0 &&
      (!thread?.title || thread.title === 'New Thread')
    ) {
      renameThread(threadId, normalizedText)
    }

    const allAttachments = getAttachments(threadId)
    const imageAttachments = files?.map((file) => {
      const base64 = file.url.split(',')[1] || ''
      return createImageAttachment({
        name: `image-${Date.now()}`,
        mimeType: file.mediaType,
        dataUrl: file.url,
        base64,
        size: Math.ceil((base64.length * 3) / 4),
      })
    })
    const combinedAttachments = [
      ...(imageAttachments || []),
      ...allAttachments.filter((a) => a.type === 'document'),
    ]
    let processedAttachments = combinedAttachments

    if (combinedAttachments.length > 0) {
      try {
        const parsePreference = useAttachments.getState().parseMode
        const result = await processAttachmentsForSend({
          attachments: combinedAttachments,
          threadId,
          projectId: thread?.metadata?.project?.id,
          serviceHub,
          selectedProvider,
          parsePreference,
        })
        processedAttachments = result.processedAttachments
        if (result.hasEmbeddedDocuments) {
          useThreads.getState().updateThread(threadId, {
            metadata: { ...thread?.metadata, hasDocuments: true },
          })
        }
      } catch {
        return
      }
    }

    const messageId = generateId()
    const userMessage = newUserThreadContent(
      threadId,
      normalizedText,
      processedAttachments,
      messageId
    )
    addMessage(userMessage)

    const parts: Array<
      | { type: 'text'; text: string }
      | { type: 'file'; mediaType: string; url: string }
    > = [{ type: 'text', text: userMessage.content[0].text?.value ?? normalizedText }]

    files?.forEach((file) => {
      parts.push({ type: 'file', mediaType: file.mediaType, url: file.url })
    })

    sendMessage({
      parts,
      id: messageId,
      metadata: userMessage.metadata,
    })
    clearAttachmentsForThread(threadId)
  }

  return (
    <div className="h-full rounded-md border bg-background flex flex-col overflow-hidden relative">
      {splitPinnedResearch && (
        <div className="absolute inset-0 z-10 flex flex-col bg-background">
          <ResearchPanel threadId={threadId} onClose={() => clearResearch(threadId)} />
        </div>
      )}
      <div className="px-3 py-2 border-b text-sm font-medium truncate flex items-center justify-between gap-2">        
        <div className="flex items-center gap-2 min-w-0">
          {paneLogo && (
            <img
              src={paneLogo}
              alt={thread?.title || 'Thread Logo'}
              className="size-5 rounded-sm object-cover shrink-0"
            />
          )}
          <span className="truncate">{thread?.title || 'New Thread'}</span>
        </div>
        {onClose && (
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowThreadPromptEditor((value) => !value)}
            >
              Thread Prompt
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0"
              onClick={onClose}
            >
              <X className="size-4" />
            </Button>
          </div>
        )}
      </div>
      {showThreadPromptEditor && (
        <div className="border-b p-2 space-y-2">
          <p className="text-xs text-muted-foreground">
            {promptResolution.source === 'thread'
              ? 'Using Thread Prompt'
              : promptResolution.source === 'project'
                ? 'Inheriting from Project Prompt'
                : promptResolution.source === 'global'
                  ? 'Inheriting from Global Prompt'
                  : 'Using Fallback Prompt'}
          </p>
          <Textarea
            value={threadPromptDraft}
            onChange={(event) => setThreadPromptDraft(event.target.value)}
            className="min-h-20"
            placeholder="Leave empty to inherit from project/global."
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setThreadPromptDraft('')
                updateThread(threadId, {
                  metadata: {
                    ...thread?.metadata,
                    threadPrompt: null,
                  },
                })
              }}
            >
              Clear Override
            </Button>
            <Button
              size="sm"
              onClick={() =>
                {
                  updateThread(threadId, {
                    metadata: {
                      ...thread?.metadata,
                      threadPrompt: threadPromptDraft.trim() || null,
                    },
                  })
                  setShowThreadPromptEditor(false)
                }
              }
            >
              Save
            </Button>
          </div>
        </div>
      )}
      <div className="flex-1 relative">
        <Conversation className="absolute inset-0 text-start">
          <ConversationContent className={cn('mx-auto w-full px-2')}>
            {messages.map((message, index) => {
              const isLastMessage = index === messages.length - 1
              const isFirstMessage = index === 0
              return (
                <MessageItem
                  key={message.id}
                  message={message}
                  isFirstMessage={isFirstMessage}
                  isLastMessage={isLastMessage}
                  status={status}
                  threadId={threadId}
                  reasoningContainerRef={reasoningContainerRef}
                  onRegenerate={handleRegenerate}
                  onDelete={(messageId) => {
                    deleteMessage(threadId, messageId)
                    setChatMessages(messages.filter((m) => m.id !== messageId))
                  }}
                />
              )
            })}
            {status === CHAT_STATUS.SUBMITTED && <PromptProgress />}
            {error && (
              <div className="px-4 py-3 mx-4 my-2 rounded-lg border border-destructive/10 bg-destructive/10">
                <p className="text-sm text-muted-foreground">{error.message}</p>
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </div>
      <div className="p-2">
        <ChatInput
          threadId={threadId}
          model={thread?.model}
          onSubmit={handleSubmit}
          onStop={stop}
          chatStatus={status}
        />
      </div>
    </div>
  )
}

// as route.threadsDetail
export const Route = createFileRoute('/threads/$threadId')({
  component: ThreadDetail,
})

function ThreadDetail() {
  const serviceHub = useServiceHub()
  const { threadId } = useParams({ from: Route.id })
  const navigate = useNavigate()
  const createThread = useThreads((state) => state.createThread)
  const updateThread = useThreads((state) => state.updateThread)
  const renameThread = useThreads((state) => state.renameThread)
  const setCurrentThreadId = useThreads((state) => state.setCurrentThreadId)
  const setCurrentAssistant = useAssistant((state) => state.setCurrentAssistant)
  const assistants = useAssistant((state) => state.assistants)
  const setMessages = useMessages((state) => state.setMessages)
  const addMessage = useMessages((state) => state.addMessage)
  const updateMessage = useMessages((state) => state.updateMessage)
  const deleteMessage = useMessages((state) => state.deleteMessage)
  const currentThread = useRef<string | undefined>(undefined)

  useTools()

  // Get attachments for this thread
  const attachmentsKey = threadId ?? NEW_THREAD_ATTACHMENT_KEY
  const getAttachments = useChatAttachments((state) => state.getAttachments)
  const clearAttachmentsForThread = useChatAttachments(
    (state) => state.clearAttachments
  )

  // Session data for tool call tracking
  const getSessionData = useChatSessions((state) => state.getSessionData)
  const sessionData = getSessionData(threadId)

  // AbortController for cancelling tool calls
  const toolCallAbortController = useRef<AbortController | null>(null)

  // Check if we should follow up with tool calls (respects abort signal)
  const followUpMessage = useCallback(
    ({ messages }: { messages: UIMessage[] }) => {
      if (
        !toolCallAbortController.current ||
        toolCallAbortController.current?.signal.aborted
      ) {
        return false
      }
      return lastAssistantMessageIsCompleteWithToolCalls({ messages })
    },
    []
  )

  // Subscribe directly to the thread data to ensure updates when model changes
  const thread = useThreads(useShallow((state) => state.threads[threadId]))

  // Get model and provider for useChat
  const selectedModel = useModelProvider((state) => state.selectedModel)
  const selectedProvider = useModelProvider((state) => state.selectedProvider)
  const getProviderByName = useModelProvider((state) => state.getProviderByName)
  const {
    globalDefaultPrompt,
    autoTuningEnabled,
  } = useGeneralSetting()
  const mainMemoryEnabled = useMemory((state) => state.memoryEnabled)
  const mainMemoryVersion = useMemory((state) => state.memoryVersion)
  const threadMessageCount = useMessages(
    (state) => state.messages[threadId]?.length ?? 0
  )
  const threadRef = useRef(thread)
  // Track which assistant message IDs have already had memory processed
  // (onFinish can fire multiple times; store-based check is unreliable)
  const processedMemoryMsgIds = useRef(new Set<string>())
  // Capture user text at submit time so onFinish can read it without stale-closure issues
  const lastUserInputRef = useRef('')
  const projectId = threadRef.current?.metadata?.project?.id
  const [threadPromptDraft, setThreadPromptDraft] = useState('')
  const [showThreadPromptEditor, setShowThreadPromptEditor] = useState(false)
  const [showPromptDebug, setShowPromptDebug] = useState(false)
  const [splitDirection, setSplitDirection] = useState<'left' | 'right' | null>(
    () => {
      const stored = sessionStorage.getItem(SESSION_STORAGE_KEY.SPLIT_VIEW_INFO)
      if (stored) {
        try {
          const info = JSON.parse(stored) as { splitThreadId: string; direction: 'left' | 'right' }
          return info.direction
        } catch { /* ignore */ }
      }
      return null
    }
  )
  const [splitThreadId, setSplitThreadId] = useState<string | null>(() => {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY.SPLIT_VIEW_INFO)
    if (stored) {
      try {
        sessionStorage.removeItem(SESSION_STORAGE_KEY.SPLIT_VIEW_INFO)
        const info = JSON.parse(stored) as { splitThreadId: string; direction: 'left' | 'right' }
        return info.splitThreadId
      } catch { /* ignore */ }
    }
    return null
  })

  // Artifact panel — reads from the per-thread pinned state
  const pinnedArtifact = useArtifactPanel((state) => state.pinnedByThread[threadId] ?? null)
  const clearArtifact = useArtifactPanel((state) => state.clearArtifact)

  // Research panel
  const pinnedResearch = useResearchPanel((s) => s.getPinned(threadId))
  const clearResearch = useResearchPanel((s) => s.clearResearch)
  const { startResearch } = useResearch(threadId)

  const mainMemorySuffix = useMemo(() => {
    if (!mainMemoryEnabled) return ''
    const memories = useMemory.getState().getMemories('default')
    return buildMemoryContext(memories)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainMemoryEnabled, mainMemoryVersion])

  const promptResolution = useMemo(
    () =>
      resolveSystemPrompt(
        thread?.metadata?.threadPrompt,
        thread?.metadata?.project?.projectPrompt,
        { globalDefaultPrompt }
      ),
    [
      globalDefaultPrompt,
      thread?.metadata?.project?.projectPrompt,
      thread?.metadata?.threadPrompt,
    ]
  )

  const optimizedModelConfig = useMemo(() => {
    const baseConfig = {
      temperature:
        thread?.assistants?.[0]?.parameters?.temperature as number | undefined,
      top_p: thread?.assistants?.[0]?.parameters?.top_p as number | undefined,
      max_output_tokens:
        thread?.assistants?.[0]?.parameters?.max_output_tokens as
          | number
          | undefined,
      modelId: selectedModel?.id,
    }
    if (!autoTuningEnabled) return baseConfig
    return getOptimizedModelConfig(
      {
        promptLength: promptResolution.resolvedPrompt.length,
        messageCount: threadMessageCount,
        hasAttachments: Boolean(thread?.metadata?.hasDocuments),
        modelCapabilities: selectedModel?.capabilities,
      },
      baseConfig
    )
  }, [
    autoTuningEnabled,
    promptResolution.resolvedPrompt.length,
    selectedModel?.id,
    selectedModel?.capabilities,
    thread?.assistants,
    thread?.metadata?.hasDocuments,
    threadMessageCount,
  ])

  useEffect(() => {
    threadRef.current = thread
  }, [thread])

  useEffect(() => {
    setThreadPromptDraft(
      typeof thread?.metadata?.threadPrompt === 'string'
        ? thread.metadata.threadPrompt
        : ''
    )
  }, [thread?.metadata?.threadPrompt])

  // Use the AI SDK chat hook
  const {
    messages: chatMessages,
    status,
    error,
    sendMessage,
    regenerate,
    setMessages: setChatMessages,
    stop,
    addToolOutput,
    updateRagToolsAvailability,
  } = useChat({
    sessionId: threadId,
    sessionTitle: thread?.title,
    systemMessage: promptResolution.resolvedPrompt + mainMemorySuffix + DIAGRAM_FORMAT_INSTRUCTION + CODE_EXECUTION_INSTRUCTION + ARTIFACT_FORMAT_INSTRUCTION,
    modelOverrideId: optimizedModelConfig.modelId,
    inferenceParameters: {
      temperature: optimizedModelConfig.temperature,
      top_p: optimizedModelConfig.top_p,
      max_output_tokens: optimizedModelConfig.max_output_tokens,
    },
    experimental_throttle: 50,
    onFinish: ({ message, isAbort }) => {
      // Persist assistant message to backend (skip if aborted)
      if (!isAbort && message.role === 'assistant') {
        // Extract content parts (including tool calls) as separate items in the content array
        // This preserves the natural ordering: text -> tool call -> text -> tool call, etc.
        const contentParts = extractContentPartsFromUIMessage(message)

        // Ref-based dedup — more reliable than store-based timing check
        const isNewMessage = !processedMemoryMsgIds.current.has(message.id)
        if (isNewMessage) processedMemoryMsgIds.current.add(message.id)

        // Strip memory tags + collect LLM ops from all content parts
        const allOps: MemoryDeltaOp[] = []
        for (const part of contentParts) {
          if (part.type === 'text' && part.text?.value) {
            const { ops, cleanedText } = parseMemoryDelta(part.text.value)
            part.text.value = cleanedText
            if (isNewMessage) allOps.push(...ops)
          }
        }

        if (isNewMessage && useMemory.getState().isMemoryEnabled() && contentParts.length > 0) {
          let toasted = false

          // Step 1: Apply LLM delta ops (surgical add/update/delete)
          if (allOps.length > 0) {
            const existing = useMemory.getState().getMemories('default')
            const updated = applyMemoryDelta(existing, allOps, threadId)
            useMemory.getState().importMemories('default', updated)
            const added = allOps.filter((o) => o.op === 'add').length
            const changed = allOps.filter((o) => o.op === 'update' || o.op === 'delete').length
            if (added > 0) {
              toast.success(`Remembered ${added} new fact${added !== 1 ? 's' : ''}`)
              toasted = true
            } else if (changed > 0) {
              toast.info('Updated memories')
              toasted = true
            }
          }

          // Step 2: Pattern fallback — use ref captured at submit time (no stale-closure issues)
          // mergePatternFacts deduplicates by category, so no duplicates from Step 1
          const userText = lastUserInputRef.current
          if (userText) {
            const patternFacts = extractFactsFromPatterns(userText)
            if (patternFacts.size > 0) {
              const currentMems = useMemory.getState().getMemories('default')
              const merged = mergePatternFacts(currentMems, patternFacts, threadId)
              const newlyAdded = merged.length - currentMems.length
              // Always save: pattern fallback also corrects wrong LLM-written facts
              // (e.g. LLM sets name="vegetarian", pattern corrects it to "Alex")
              useMemory.getState().importMemories('default', merged)
              if (newlyAdded > 0 && !toasted) toast.success(`Remembered ${newlyAdded} new fact${newlyAdded !== 1 ? 's' : ''}`)
            }
          }
        }

        if (contentParts.length > 0) {
          // Extract metadata from the message (including usage and tokenSpeed)
          const messageMetadata = (message.metadata || {}) as Record<
            string,
            unknown
          >

          // Create assistant message with content parts (including tool calls) and metadata
          const assistantMessage: ThreadMessage = {
            type: 'text',
            role: ChatCompletionRole.Assistant,
            content: contentParts,
            id: message.id,
            object: 'thread.message',
            thread_id: threadId,
            status: MessageStatus.Ready,
            created_at: Date.now(),
            completed_at: Date.now(),
            metadata: messageMetadata,
          }

          // Check if message with this ID already exists (onFinish can be called multiple times)
          const existingMessages = useMessages.getState().getMessages(threadId)
          const existingMessage = existingMessages.find(
            (m) => m.id === message.id
          )

          if (existingMessage) {
            updateMessage(assistantMessage)
          } else {
            addMessage(assistantMessage)
          }
        }
      }

      // Strip memory_extract tags from UI chat messages
      if (useMemory.getState().isMemoryEnabled()) {
        const sessions = useChatSessions.getState().sessions[threadId]
        if (sessions?.chat.messages) {
          const cleaned = sessions.chat.messages.map((msg) => {
            if (msg.id !== message.id || msg.role !== 'assistant') return msg
            return {
              ...msg,
              parts: msg.parts.map((part) => {
                if (part.type !== 'text') return part
                const stripped = (part as { type: 'text'; text: string }).text
                  .replace(/<memory_extract>[\s\S]*?<\/memory_extract>/, '')
                  .trimEnd()
                return { ...part, text: stripped }
              }),
            }
          })
          setChatMessages(cleaned)
        }
      }

      // Create a new AbortController for tool calls
      toolCallAbortController.current = new AbortController()
      const signal = toolCallAbortController.current.signal

      // Get cached tool names from store (initialized in useTools hook)
      const ragToolNames = useAppState.getState().ragToolNames
      const mcpToolNames = useAppState.getState().mcpToolNames

      // Process tool calls sequentially, requesting approval for each if needed
      ;(async () => {
        for (const toolCall of sessionData.tools) {
          // Check if already aborted before starting
          if (signal.aborted) {
            break
          }

          try {
            const toolName = toolCall.toolName

            // Request approval if needed (unless auto-approve is enabled)
            const approved = await useToolApproval
              .getState()
              .showApprovalModal(toolName, threadId, toolCall.input)

            if (!approved) {
              // User denied the tool call
              addToolOutput({
                state: 'output-error',
                tool: toolCall.toolName,
                toolCallId: toolCall.toolCallId,
                errorText: 'Tool execution denied by user',
              })
              continue
            }

            let result

            // Route to the appropriate service based on tool name
            if (ragToolNames.has(toolName)) {

              result = await serviceHub.rag().callTool({
                toolName,
                arguments: toolCall.input,
                threadId,
                projectId: projectId,
                scope: projectId ? 'project' : 'thread',
              })
            } else if (mcpToolNames.has(toolName)) {
              result = await serviceHub.mcp().callTool({
                toolName,
                arguments: toolCall.input,
              })
            } else {
              // Tool not found in either service
              result = {
                error: `Tool '${toolName}' not found in any service`,
              }
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
            // Ignore abort errors
            if ((error as Error).name !== 'AbortError') {
              console.error('Tool call error:', error)
              addToolOutput({
                state: 'output-error',
                tool: toolCall.toolName,
                toolCallId: toolCall.toolCallId,
                errorText: `Error: ${JSON.stringify(error)}`,
              })
            }
          }
        }

        // Clear tools after processing all
        sessionData.tools = []
        toolCallAbortController.current = null
      })().catch((error) => {
        // Ignore abort errors
        if (error.name !== 'AbortError') {
          console.error('Tool call error:', error)
        }
        sessionData.tools = []
        toolCallAbortController.current = null
      })
    },
    onToolCall: ({ toolCall }) => {
      sessionData.tools.push(toolCall)
    },
    sendAutomaticallyWhen: followUpMessage,
  })

  // Get disabled tools for this thread to trigger re-render when they change
  const disabledTools = useToolAvailable((state) =>
    state.getDisabledToolsForThread(threadId)
  )

  // Update RAG tools availability when documents, model, or tool availability changes
  useEffect(() => {
    const checkDocumentsAvailability = async () => {
      const hasThreadDocuments = Boolean(thread?.metadata?.hasDocuments)
      let hasProjectDocuments = false

      // Check if thread belongs to a project and if that project has files
      const projectId = thread?.metadata?.project?.id
      if (projectId) {
        try {
          const ext = ExtensionManager.getInstance().get<VectorDBExtension>(
            ExtensionTypeEnum.VectorDB
          )
          if (ext?.listAttachmentsForProject) {
            const projectFiles = await ext.listAttachmentsForProject(projectId)
            hasProjectDocuments = projectFiles.length > 0
          }
        } catch (error) {
          console.warn('Failed to check project files:', error)
        }
      }

      const hasDocuments = hasThreadDocuments || hasProjectDocuments
      const ragFeatureAvailable = Boolean(useAttachments.getState().enabled)
      const modelSupportsTools =
        selectedModel?.capabilities?.includes('tools') ?? false

      updateRagToolsAvailability(
        hasDocuments,
        modelSupportsTools,
        ragFeatureAvailable
      )
    }

    checkDocumentsAvailability()
  }, [
    thread?.metadata?.hasDocuments,
    thread?.metadata?.project?.id,
    selectedModel?.capabilities,
    updateRagToolsAvailability,
    disabledTools, // Re-run when tools are enabled/disabled
  ])

  // Ref for reasoning container auto-scroll
  const reasoningContainerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll reasoning container to bottom during streaming
  useEffect(() => {
    if (status === 'streaming' && reasoningContainerRef.current) {
      reasoningContainerRef.current.scrollTop =
        reasoningContainerRef.current.scrollHeight
    }
  }, [status, chatMessages])

  useEffect(() => {
    setCurrentThreadId(threadId)
    const assistant = assistants.find(
      (assistant) => assistant.id === thread?.assistants?.[0]?.id
    )
    if (assistant) setCurrentAssistant(assistant)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, assistants])

  // Load messages on first mount
  useEffect(() => {
    // Skip if chat already has messages (e.g., returning to a streaming conversation)
    const existingSession = useChatSessions.getState().sessions[threadId]
    if (
      existingSession?.chat.messages.length > 0 ||
      existingSession?.isStreaming ||
      currentThread.current === threadId
    ) {
      return
    }

    serviceHub
      .messages()
      .fetchMessages(threadId)
      .then((fetchedMessages) => {
        if (fetchedMessages && fetchedMessages.length > 0) {
          const currentLocalMessages = useMessages
            .getState()
            .getMessages(threadId)

          let messagesToSet = fetchedMessages

          // Merge with local-only messages if needed
          if (currentLocalMessages && currentLocalMessages.length > 0) {
            const fetchedIds = new Set(fetchedMessages.map((m) => m.id))
            const localOnlyMessages = currentLocalMessages.filter(
              (m) => !fetchedIds.has(m.id)
            )

            if (localOnlyMessages.length > 0) {
              messagesToSet = [...fetchedMessages, ...localOnlyMessages].sort(
                (a, b) => (a.created_at || 0) - (b.created_at || 0)
              )
            }
          }

          // Update the legacy store
          setMessages(threadId, messagesToSet)

          // Convert and set messages for AI SDK chat
          const uiMessages = convertThreadMessagesToUIMessages(messagesToSet)
          setChatMessages(uiMessages)
          currentThread.current = threadId
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, serviceHub])

  useEffect(() => {
    return () => {
      // Clear the current thread ID when the component unmounts
      setCurrentThreadId(undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Consolidated function to process and send a message
  const processAndSendMessage = useCallback(
    async (
      text: string,
      files?: Array<{ type: string; mediaType: string; url: string }>
    ) => {
      const normalizedText = text.trim()
      lastUserInputRef.current = normalizedText

      // Handle /remember command
      if (normalizedText.startsWith('/remember ')) {
        const fact = normalizedText.slice('/remember '.length).trim()
        if (fact) {
          const now = Date.now()
          useMemory.getState().addMemories('default', [{
            id: `mem-${now}-manual`,
            fact,
            category: 'manual',
            sourceThreadId: threadId,
            createdAt: now,
            updatedAt: now,
          }])
          toast.success(`Remembered: "${fact}"`)
        }
        return
      }

      // Handle /forget command
      if (normalizedText.startsWith('/forget ')) {
        const query = normalizedText.slice('/forget '.length).trim().toLowerCase()
        if (query) {
          const memories = useMemory.getState().getMemories('default')
          const match = memories.find(m => m.fact.toLowerCase().includes(query))
          if (match) {
            useMemory.getState().deleteMemory('default', match.id)
            toast.success(`Forgot: "${match.fact}"`)
          } else {
            toast.info(`No memory found matching "${query}"`)
          }
        }
        return
      }

      // Rename thread on first message if still using default title
      const currentThread = useThreads.getState().threads[threadId]
      const currentMessages = useMessages.getState().getMessages(threadId)
      if (
        normalizedText &&
        currentMessages.length === 0 &&
        (!currentThread?.title || currentThread.title === 'New Thread')
      ) {
        renameThread(threadId, normalizedText)
      }

      // Get all attachments from the store (includes both images and documents)
      const allAttachments = getAttachments(attachmentsKey)

      // Convert image files to attachments for persistence
      const imageAttachments = files?.map((file) => {
        const base64 = file.url.split(',')[1] || ''
        return createImageAttachment({
          name: `image-${Date.now()}`,
          mimeType: file.mediaType,
          dataUrl: file.url,
          base64,
          size: Math.ceil((base64.length * 3) / 4), // Estimate size from base64
        })
      })

      // Combine image attachments with document attachments from the store
      const combinedAttachments = [
        ...(imageAttachments || []),
        ...allAttachments.filter((a) => a.type === 'document'),
      ]

      // Process attachments (ingest images, parse/index documents)
      let processedAttachments = combinedAttachments
      const projectId = thread?.metadata?.project?.id
      if (combinedAttachments.length > 0) {
        try {
          const parsePreference = useAttachments.getState().parseMode
          const result = await processAttachmentsForSend({
            attachments: combinedAttachments,
            threadId,
            projectId,
            serviceHub,
            selectedProvider,
            parsePreference,
          })
          processedAttachments = result.processedAttachments

          // Update thread metadata if documents were embedded
          if (result.hasEmbeddedDocuments) {
            useThreads.getState().updateThread(threadId, {
              metadata: { hasDocuments: true },
            })
          }
        } catch (error) {
          console.error('Failed to process attachments:', error)
          // Don't send message if attachment processing failed
          return
        }
      }

      const messageId = generateId()
      // Create and persist the user message to the backend with all processed attachments
      const userMessage = newUserThreadContent(
        threadId,
        text,
        processedAttachments,
        messageId
      )
      addMessage(userMessage)

      // Build parts for AI SDK (only images are sent as file parts)
      const parts: Array<
        | { type: 'text'; text: string }
        | { type: 'file'; mediaType: string; url: string }
      > = [
        {
          type: 'text',
          text: userMessage.content[0].text?.value ?? text,
        },
      ]

      if (files) {
        files.forEach((file) => {
          parts.push({
            type: 'file',
            mediaType: file.mediaType,
            url: file.url,
          })
        })
      }

      sendMessage({
        parts,
        id: messageId,
        metadata: userMessage.metadata,
      })

      // Clear attachments after sending
      clearAttachmentsForThread(attachmentsKey)
    },
    [
      sendMessage,
      threadId,
      thread,
      addMessage,
      renameThread,
      getAttachments,
      attachmentsKey,
      clearAttachmentsForThread,
      serviceHub,
      selectedProvider,
    ]
  )

  // Check for and send initial message from sessionStorage
  const initialMessageSentRef = useRef(false)
  useEffect(() => {
    // Prevent duplicate sends
    if (initialMessageSentRef.current) return

    const initialMessageKey = `${SESSION_STORAGE_PREFIX.INITIAL_MESSAGE}${threadId}`

    const storedMessage = sessionStorage.getItem(initialMessageKey)

    if (storedMessage) {
      // Mark as sent immediately to prevent duplicate sends
      sessionStorage.removeItem(initialMessageKey)
      initialMessageSentRef.current = true

      // Process message asynchronously
      ;(async () => {
        try {
          const message = JSON.parse(storedMessage) as {
            text: string
            files?: Array<{ type: string; mediaType: string; url: string }>
          }

          // Check for /research command before falling through to normal chat
          const trimmed = message.text.trimStart()
          if (trimmed.toLowerCase().startsWith('/research')) {
            const afterCommand = trimmed.slice('/research'.length)
            const depth = parseResearchDepth(afterCommand)
            const query = afterCommand.replace(/^:(standard|deep|[123])?\s*/i, '').trim()
            if (query) {
              startResearch(query, depth)
              return
            }
          }

          await processAndSendMessage(message.text, message.files)
        } catch (error) {
          console.error('Failed to parse initial message:', error)
        }
      })()
    }
  }, [threadId, processAndSendMessage, startResearch])

  // Apply thread prompt drafted from the new-chat page
  const threadPromptAppliedRef = useRef(false)
  useEffect(() => {
    if (threadPromptAppliedRef.current) return
    const storedPrompt = sessionStorage.getItem(
      SESSION_STORAGE_KEY.NEW_THREAD_PROMPT
    )
    if (storedPrompt) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY.NEW_THREAD_PROMPT)
      threadPromptAppliedRef.current = true
      updateThread(threadId, {
        metadata: {
          ...thread?.metadata,
          threadPrompt: storedPrompt,
        },
      })
      setThreadPromptDraft(storedPrompt)
    }
  }, [threadId, thread?.metadata, updateThread])

  // Handle submit from ChatInput
  const handleSubmit = useCallback(
    async (
      text: string,
      files?: Array<{ type: string; mediaType: string; url: string }>
    ) => {
      // /research[:mode] <query> — open the Research Panel instead of normal chat
      // mode is optional: quick | standard (default) | deep
      const trimmed = text.trimStart()
      if (trimmed.toLowerCase().startsWith('/research')) {
        const afterCommand = trimmed.slice('/research'.length)
        const depth = parseResearchDepth(afterCommand)
        const query = afterCommand.replace(/^:(standard|deep|[123])?\s*/i, '').trim()
        if (query) {
          startResearch(query, depth)
          return
        }
      }
      await processAndSendMessage(text, files)
    },
    [processAndSendMessage, startResearch]
  )

  // Handle regenerate from any message (user or assistant)
  // - For user messages: keeps the user message, deletes all after, regenerates assistant response
  // - For assistant messages: finds the closest preceding user message, deletes from there
  const handleRegenerate = (messageId?: string) => {
    const currentLocalMessages = useMessages.getState().getMessages(threadId)

    // If regenerating from a specific message, delete all messages after it
    if (messageId) {
      // Find the message in the current chat messages
      const messageIndex = currentLocalMessages.findIndex(
        (m) => m.id === messageId
      )

      if (messageIndex !== -1) {
        const selectedMessage = currentLocalMessages[messageIndex]

        // If it's an assistant message, find the closest preceding user message
        let deleteFromIndex = messageIndex
        if (selectedMessage.role === 'assistant') {
          // Look backwards to find the closest user message
          for (let i = messageIndex - 1; i >= 0; i--) {
            if (currentLocalMessages[i].role === 'user') {
              deleteFromIndex = i
              break
            }
          }
        }

        // Get all messages after the delete point
        const messagesToDelete = currentLocalMessages.slice(deleteFromIndex + 1)

        // Delete from backend storage
        if (messagesToDelete.length > 0) {
          messagesToDelete.forEach((msg) => {
            deleteMessage(threadId, msg.id)
          })
        }
      }
    }

    // Call the AI SDK regenerate function - it will handle truncating the UI messages
    // and generating a new response from the selected message
    regenerate(messageId ? { messageId } : undefined)
  }

  // Handle edit message - updates the message and regenerates from it
  const handleEditMessage = useCallback(
    (messageId: string, newText: string) => {
      const currentLocalMessages = useMessages.getState().getMessages(threadId)
      const messageIndex = currentLocalMessages.findIndex(
        (m) => m.id === messageId
      )

      if (messageIndex === -1) return

      const originalMessage = currentLocalMessages[messageIndex]

      // Update the message content
      const updatedMessage = {
        ...originalMessage,
        content: [
          {
            type: ContentType.Text,
            text: { value: newText, annotations: [] },
          },
        ],
      }
      updateMessage(updatedMessage)

      // Update chat messages for UI
      const updatedChatMessages = chatMessages.map((msg) => {
        if (msg.id === messageId) {
          return {
            ...msg,
            parts: [{ type: 'text' as const, text: newText }],
          }
        }
        return msg
      })
      setChatMessages(updatedChatMessages)

      // Only regenerate if the edited message is from the user
      if (updatedMessage.role === 'assistant') return

      // Delete all messages after this one and regenerate
      const messagesToDelete = currentLocalMessages.slice(messageIndex + 1)
      messagesToDelete.forEach((msg) => {
        deleteMessage(threadId, msg.id)
      })

      // Regenerate from the edited message
      regenerate({ messageId })
    },
    [
      threadId,
      updateMessage,
      deleteMessage,
      chatMessages,
      setChatMessages,
      regenerate,
    ]
  )

  // Handle delete message
  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      deleteMessage(threadId, messageId)

      // Update chat messages for UI
      const updatedChatMessages = chatMessages.filter(
        (msg) => msg.id !== messageId
      )
      setChatMessages(updatedChatMessages)
    },
    [threadId, deleteMessage, chatMessages, setChatMessages]
  )

  // Handler for increasing context size
  const handleContextSizeIncrease = useCallback(async () => {
    if (!selectedModel) return

    const updateProvider = useModelProvider.getState().updateProvider
    const provider = getProviderByName(selectedProvider)
    if (!provider) return

    const modelIndex = provider.models.findIndex(
      (m) => m.id === selectedModel.id
    )
    if (modelIndex === -1) return

    const model = provider.models[modelIndex]

    // Increase context length by 50%
    const currentCtxLen =
      (model.settings?.ctx_len?.controller_props?.value as number) ?? 8192
    const newCtxLen = Math.round(Math.max(8192, currentCtxLen) * 1.5)

    const updatedModel = {
      ...model,
      settings: {
        ...model.settings,
        ctx_len: {
          ...(model.settings?.ctx_len ?? {}),
          controller_props: {
            ...(model.settings?.ctx_len?.controller_props ?? {}),
            value: newCtxLen,
          },
        },
      },
    }

    const updatedModels = [...provider.models]
    updatedModels[modelIndex] = updatedModel as Model

    updateProvider(provider.provider, {
      models: updatedModels,
    })

    await serviceHub.models().stopModel(selectedModel.id)

    setTimeout(() => {
      handleRegenerate()
    }, 1000)
  }, [
    selectedModel,
    selectedProvider,
    getProviderByName,
    serviceHub,
    handleRegenerate,
  ])

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
  const splitPaneOrder = useMemo(() => {
    if (!splitThreadId || !splitDirection) return null
    return splitDirection === 'left' ? ['split', 'main'] : ['main', 'split']
  }, [splitDirection, splitThreadId])

  const handleSplit = useCallback(
    async (direction: 'left' | 'right') => {
      if (splitThreadId) {
        setSplitDirection(direction)
        return
      }

      const newThread = await createThread(
        {
          id: thread?.model?.id ?? selectedModel?.id ?? '*',
          provider: thread?.model?.provider ?? selectedProvider,
        },
        'New Thread',
        thread?.assistants?.[0],
        thread?.metadata?.project
      )
      setSplitThreadId(newThread.id)
      setSplitDirection(direction)
    },
    [
      createThread,
      selectedModel?.id,
      selectedProvider,
      splitThreadId,
      thread?.assistants,
      thread?.metadata?.project,
      thread?.model?.id,
      thread?.model?.provider,
    ]
  )

  return (
    <div className="flex flex-col h-[calc(100dvh-(env(safe-area-inset-bottom)+env(safe-area-inset-top)))]">
      <HeaderPage>
        <div className="flex items-center w-full pr-2">
          <DropdownModelProvider model={threadModel} />
        </div>
      </HeaderPage>
      <div className="flex flex-1 flex-col h-full overflow-hidden">
        <div className="px-4 md:px-8 pb-2 shrink-0">
          <div className="mx-auto w-full md:w-4/5 xl:w-4/6 flex items-center justify-end gap-2">
            {!splitPaneOrder && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowThreadPromptEditor((value) => !value)}
                >
                  Thread Prompt
                </Button>
                <Button
                  variant={showPromptDebug ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => setShowPromptDebug((value) => !value)}
                >
                  Debug
                </Button>
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Columns2 className="size-4" />
                  <span>Split View</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => handleSplit('left')}>
                  Split Left
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleSplit('right')}>
                  Split Right
                </DropdownMenuItem>
                {splitPaneOrder && (
                  <DropdownMenuItem
                    onSelect={() => {
                      setSplitThreadId(null)
                      setSplitDirection(null)
                    }}
                  >
                    Close Split View
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {!splitPaneOrder && showThreadPromptEditor && (
            <div className="mx-auto w-full md:w-4/5 xl:w-4/6 mt-2 rounded-md border bg-card p-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                {promptResolution.source === 'thread'
                  ? 'Using Thread Prompt'
                  : promptResolution.source === 'project'
                    ? 'Inheriting from Project Prompt'
                    : promptResolution.source === 'global'
                      ? 'Inheriting from Global Prompt'
                      : 'Using Fallback Prompt'}
              </p>
              <Textarea
                value={threadPromptDraft}
                onChange={(event) => setThreadPromptDraft(event.target.value)}
                className="min-h-24"
                placeholder="Leave empty to inherit from project/global."
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setThreadPromptDraft('')
                    updateThread(threadId, {
                      metadata: {
                        ...thread?.metadata,
                        threadPrompt: null,
                      },
                    })
                  }}
                >
                  Clear Override
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    {
                      updateThread(threadId, {
                        metadata: {
                          ...thread?.metadata,
                          threadPrompt: threadPromptDraft.trim() || null,
                        },
                      })
                      setShowThreadPromptEditor(false)
                    }
                  }
                >
                  Save
                </Button>
              </div>
            </div>
          )}
          {!splitPaneOrder && showPromptDebug && (
            <div className="mx-auto w-full md:w-4/5 xl:w-4/6 mt-2 rounded-md border bg-card p-3 text-xs space-y-1">
              <p>
                <span className="font-medium">Source:</span> {promptResolution.source}
              </p>
              <p>
                <span className="font-medium">Auto Tuning:</span>{' '}
                {autoTuningEnabled ? 'Enabled' : 'Disabled'}
              </p>
              <p>
                <span className="font-medium">temperature:</span>{' '}
                {optimizedModelConfig.temperature ?? 'default'}
              </p>
              <p>
                <span className="font-medium">top_p:</span>{' '}
                {optimizedModelConfig.top_p ?? 'default'}
              </p>
              <p>
                <span className="font-medium">max_output_tokens:</span>{' '}
                {optimizedModelConfig.max_output_tokens ?? 'default'}
              </p>
              <pre className="bg-muted rounded p-2 whitespace-pre-wrap break-words">
                {promptResolution.resolvedPrompt}
              </pre>
            </div>
          )}
        </div>
        {splitPaneOrder && splitThreadId ? (
          <div className="grid grid-cols-2 gap-2 px-2 pb-2 h-full">
            {splitPaneOrder.map((pane) =>
              pane === 'main' ? (
                <div
                  key="main-pane"
                  className="h-full rounded-md border bg-background overflow-hidden flex flex-col relative"
                >
                  {pinnedResearch && (
                    <div className="absolute inset-0 z-10 flex flex-col bg-background">
                      <ResearchPanel threadId={threadId} onClose={() => clearResearch(threadId)} />
                    </div>
                  )}
                  <div className="px-3 py-2 border-b text-sm font-medium truncate">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {threadLogo && (
                          <img
                            src={threadLogo}
                            alt={thread?.title || 'Thread Logo'}
                            className="size-5 rounded-sm object-cover shrink-0"
                          />
                        )}
                        <span className="truncate">{thread?.title || 'Current Thread'}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setShowThreadPromptEditor((value) => !value)
                          }
                        >
                          Thread Prompt
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="shrink-0"
                          onClick={() => {
                            if (!splitThreadId) return
                            setSplitThreadId(null)
                            setSplitDirection(null)
                            navigate({
                              to: '/threads/$threadId',
                              params: { threadId: splitThreadId },
                            })
                          }}
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                  {showThreadPromptEditor && (
                    <div className="border-b p-2 space-y-2">
                      <p className="text-xs text-muted-foreground">
                        {promptResolution.source === 'thread'
                          ? 'Using Thread Prompt'
                          : promptResolution.source === 'project'
                            ? 'Inheriting from Project Prompt'
                            : promptResolution.source === 'global'
                              ? 'Inheriting from Global Prompt'
                              : 'Using Fallback Prompt'}
                      </p>
                      <Textarea
                        value={threadPromptDraft}
                        onChange={(event) => setThreadPromptDraft(event.target.value)}
                        className="min-h-20"
                        placeholder="Leave empty to inherit from project/global."
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setThreadPromptDraft('')
                            updateThread(threadId, {
                              metadata: {
                                ...thread?.metadata,
                                threadPrompt: null,
                              },
                            })
                          }}
                        >
                          Clear Override
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            updateThread(threadId, {
                              metadata: {
                                ...thread?.metadata,
                                threadPrompt: threadPromptDraft.trim() || null,
                              },
                            })
                            setShowThreadPromptEditor(false)
                          }}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Messages Area */}
                    <div className="flex-1 relative">
                      <Conversation className="absolute inset-0 text-start">
                        <ConversationContent className={cn('mx-auto w-full px-2')}>
                          {chatMessages.map((message, index) => {
                            const isLastMessage = index === chatMessages.length - 1
                            const isFirstMessage = index === 0
                            return (
                              <MessageItem
                                key={message.id}
                                message={message}
                                isFirstMessage={isFirstMessage}
                                isLastMessage={isLastMessage}
                                status={status}
                                threadId={threadId}
                                reasoningContainerRef={reasoningContainerRef}
                                onRegenerate={handleRegenerate}
                                onEdit={handleEditMessage}
                                onDelete={handleDeleteMessage}
                              />
                            )
                          })}
                          {status === CHAT_STATUS.SUBMITTED && <PromptProgress />}
                        </ConversationContent>
                        <ConversationScrollButton />
                      </Conversation>
                    </div>
                    <div className="p-2">
                      <ChatInput
                        threadId={threadId}
                        model={threadModel}
                        onSubmit={handleSubmit}
                        onStop={stop}
                        chatStatus={status}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <SplitThreadPane
                  key="split-pane"
                  threadId={splitThreadId}
                  onClose={() => {
                    setSplitThreadId(null)
                    setSplitDirection(null)
                  }}
                />
              )
            )}
          </div>
        ) : (
          <div className={(pinnedArtifact || pinnedResearch) ? 'grid grid-cols-2 gap-2 px-2 pb-2 h-full' : 'flex flex-1 flex-col h-full overflow-hidden'}>
          {/* Main chat column */}
          <div className={(pinnedArtifact || pinnedResearch) ? 'h-full rounded-md border bg-background overflow-hidden flex flex-col' : 'flex flex-1 flex-col h-full overflow-hidden'}>
        <div className="px-4 md:px-8 pb-2 shrink-0">
          <div className="mx-auto w-full md:w-4/5 xl:w-4/6 flex items-center gap-2 min-w-0">
            {threadLogo && (
              <img
                src={threadLogo}
                alt={thread?.title || 'Thread Logo'}
                className="size-5 rounded-sm object-cover shrink-0"
              />
            )}
            <h2 className="text-sm font-medium truncate">{thread?.title || 'New Thread'}</h2>
          </div>
        </div>
        {/* Messages Area */}
        <div className="flex-1 relative">
          <Conversation className="absolute inset-0 text-start">
            <ConversationContent
              className={cn((pinnedArtifact || pinnedResearch) ? 'mx-auto w-full px-2' : 'mx-auto w-full md:w-4/5 xl:w-4/6')}
            >
              {chatMessages.map((message, index) => {
                const isLastMessage = index === chatMessages.length - 1
                const isFirstMessage = index === 0
                return (
                  <MessageItem
                    key={message.id}
                    message={message}
                    isFirstMessage={isFirstMessage}
                    isLastMessage={isLastMessage}
                    status={status}
                    threadId={threadId}
                    reasoningContainerRef={reasoningContainerRef}
                    onRegenerate={handleRegenerate}
                    onEdit={handleEditMessage}
                    onDelete={handleDeleteMessage}
                  />
                )
              })}
              {status === CHAT_STATUS.SUBMITTED && <PromptProgress />}
              {error && (
                <div className="px-4 py-3 mx-4 my-2 rounded-lg border border-destructive/10 bg-destructive/10">
                  <div className="flex items-start gap-3">
                    <IconAlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-destructive mb-1">
                        Error generating response
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {error.message}
                      </p>
                      {(error.message?.toLowerCase().includes('context') &&
                        (error.message?.toLowerCase().includes('size') ||
                          error.message?.toLowerCase().includes('length') ||
                          error.message?.toLowerCase().includes('limit'))) ||
                      error.message === OUT_OF_CONTEXT_SIZE ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-3"
                          onClick={handleContextSizeIncrease}
                        >
                          <IconAlertCircle className="size-4 mr-2" />
                          Increase Context Size
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>
        </div>

        {/* Chat Input - Fixed at bottom */}
        <div className={(pinnedArtifact || pinnedResearch) ? 'p-2' : 'py-4 mx-auto w-full md:w-4/5 xl:w-4/6'}>
          <ChatInput
            threadId={threadId}
            model={threadModel}
            onSubmit={handleSubmit}
            onStop={stop}
            chatStatus={status}
          />
        </div>
          </div>
          {/* Right panel — Research takes priority over Artifact */}
          {pinnedResearch && (
            <ResearchPanel
              threadId={threadId}
              onClose={() => clearResearch(threadId)}
            />
          )}
          {!pinnedResearch && pinnedArtifact && (
            <ArtifactPanel
              threadId={threadId}
              onClose={() => clearArtifact(threadId)}
            />
          )}
          </div>
        )}
      </div>
    </div>
  )
}
