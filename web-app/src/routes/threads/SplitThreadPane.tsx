import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChatInput from '@/containers/ChatInput'
import { cn } from '@/lib/utils'
import { useThreads } from '@/hooks/useThreads'
import { useShallow } from 'zustand/react/shallow'
import { useMessages } from '@/hooks/useMessages'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useChat } from '@/hooks/use-chat'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useAssistant } from '@/hooks/useAssistant'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { generateId } from 'ai'
import { useChatSessions } from '@/stores/chat-session-store'
import {
  convertThreadMessagesToUIMessages,
  extractContentPartsFromUIMessage,
} from '@/lib/messages'
import { newUserThreadContent } from '@/lib/completion'
import { ThreadMessage, MessageStatus, ChatCompletionRole } from '@ax-studio/core'
import { PromptProgress } from '@/components/PromptProgress'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { X } from 'lucide-react'
import { useAgentTeamStore } from '@/stores/agent-team-store'
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
import { ResearchPanel } from '@/components/research/ResearchPanel'
import { useResearchPanel } from '@/hooks/useResearchPanel'
import { useResearch } from '@/hooks/useResearch'
import { useThreadTools } from '@/hooks/thread/use-thread-tools'
import { MessageItem } from '@/containers/MessageItem'

/** Parse /research[:mode] prefix into a depth number (2=Standard, 3=Deep). */
function parseResearchDepth(afterCommand: string): 2 | 3 {
  return /^:(deep|3)\b/i.test(afterCommand) ? 3 : 2
}

const CHAT_STATUS = {
  STREAMING: 'streaming',
  SUBMITTED: 'submitted',
} as const

export function SplitThreadPane({
  threadId,
  onClose,
}: {
  threadId: string
  onClose?: () => void
}) {
  const serviceHub = useServiceHub()
  const thread = useThreads(useShallow((state) => state.threads[threadId]))
  const currentAssistant = useAssistant((state) => state.currentAssistant)
  const splitPinnedResearch = useResearchPanel((s) => s.getPinned(threadId))
  const clearResearch = useResearchPanel((s) => s.clearResearch)
  const { startResearch } = useResearch(threadId)
  const renameThread = useThreads((state) => state.renameThread)
  const updateThread = useThreads((state) => state.updateThread)
  const setMessages = useMessages((state) => state.setMessages)
  const addMessage = useMessages((state) => state.addMessage)
  const updateMessage = useMessages((state) => state.updateMessage)
  const deleteMessage = useMessages((state) => state.deleteMessage)
  const selectedModel = useModelProvider((state) => state.selectedModel)
  const { globalDefaultPrompt, autoTuningEnabled } = useGeneralSetting()
  const globalMemoryEnabled = useMemory((state) => state.memoryEnabled)
  const memoryEnabledPerThread = useMemory((state) => state.memoryEnabledPerThread)
  const memoryEnabled = threadId in memoryEnabledPerThread
    ? memoryEnabledPerThread[threadId]
    : globalMemoryEnabled
  const defaultMemories = useMemory(useShallow((state) => state.memories['default'] || []))
  const messageCount = useMessages(
    (state) => state.messages[threadId]?.length ?? 0
  )
  const projectId = thread?.metadata?.project?.id
  const {
    followUpMessage, onToolCall, startToolExecution, onCostApproval, handleTeamChange,
  } = useThreadTools({ threadId, projectId })
  const agentTeams = useAgentTeamStore((s) => s.teams)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeTeamId = (thread?.metadata?.agent_team_id as string) ?? undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeTeam = agentTeams.find((t: any) => t.id === activeTeamId)
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
    return buildMemoryContext(defaultMemories)
  }, [memoryEnabled, defaultMemories])

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
    addToolOutput,
  } = useChat({
    sessionId: threadId,
    sessionTitle: thread?.title,
    systemMessage: promptResolution.resolvedPrompt + (currentAssistant?.instructions && currentAssistant.id !== 'ax-studio' ? '\n\n' + currentAssistant.instructions : '') + memorySuffix + DIAGRAM_FORMAT_INSTRUCTION + CODE_EXECUTION_INSTRUCTION + ARTIFACT_FORMAT_INSTRUCTION,
    modelOverrideId: optimizedModelConfig.modelId,
    activeTeamId: (thread?.metadata?.agent_team_id as string) ?? undefined,
    onCostApproval,
    inferenceParameters: {
      temperature: optimizedModelConfig.temperature,
      top_p: optimizedModelConfig.top_p,
      max_output_tokens: optimizedModelConfig.max_output_tokens,
    },
    experimental_throttle: 50,
    onToolCall,
    sendAutomaticallyWhen: followUpMessage,
    onFinish: ({ message, isAbort }) => {
      if (!isAbort && message.role === 'assistant') {
        const contentParts = extractContentPartsFromUIMessage(message)

        const isNewMessage = !processedMemoryMsgIds.current.has(message.id)
        if (isNewMessage) processedMemoryMsgIds.current.add(message.id)

        const allOps: MemoryDeltaOp[] = []
        for (const part of contentParts) {
          if (part.type === 'text' && part.text?.value) {
            const { ops, cleanedText } = parseMemoryDelta(part.text.value)
            part.text.value = cleanedText
            if (isNewMessage) allOps.push(...ops)
          }
        }

        if (isNewMessage && useMemory.getState().isMemoryEnabledForThread(threadId) && contentParts.length > 0) {
          let toasted = false

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

      if (useMemory.getState().isMemoryEnabledForThread(threadId)) {
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

      startToolExecution(addToolOutput)
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
    let ignore = false
    serviceHub
      .messages()
      .fetchMessages(threadId)
      .then((fetchedMessages) => {
        if (ignore) return
        if (fetchedMessages && fetchedMessages.length > 0) {
          setMessages(threadId, fetchedMessages)
          setChatMessages(convertThreadMessagesToUIMessages(fetchedMessages))
        }
      })
    return () => { ignore = true }
  }, [serviceHub, setChatMessages, setMessages, threadId])

  const handleSubmit = async (text: string) => {
    const normalizedText = text.trim()
    lastUserInputRef.current = normalizedText

    if (normalizedText.startsWith('/research')) {
      const afterCommand = normalizedText.slice('/research'.length)
      const depth = parseResearchDepth(afterCommand)
      const query = afterCommand.replace(/^:(standard|deep|[123])?\s*/i, '').trim()
      if (query) {
        startResearch(query, depth)
        return
      }
    }

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

    const messageId = generateId()
    const userMessage = newUserThreadContent(
      threadId,
      normalizedText,
      undefined,
      messageId
    )
    addMessage(userMessage)

    sendMessage({
      parts: [{ type: 'text', text: userMessage.content[0].text?.value ?? normalizedText }],
      id: messageId,
      metadata: userMessage.metadata,
    })
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant={activeTeamId ? 'secondary' : 'outline'} size="sm">
                  {activeTeam ? activeTeam.name : 'Agent Team'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => handleTeamChange(undefined)}>
                  No Team (single agent)
                </DropdownMenuItem>
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {agentTeams.map((team: any) => (
                  <DropdownMenuItem key={team.id} onSelect={() => handleTeamChange(team.id)}>
                    {team.name}{team.id === activeTeamId && ' ✓'}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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
      <div className="relative">
        <div
          className="absolute -top-8 left-0 right-0 h-8 pointer-events-none z-10"
          style={{ background: 'linear-gradient(to top, var(--background) 20%, transparent)' }}
        />
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
    </div>
  )
}

