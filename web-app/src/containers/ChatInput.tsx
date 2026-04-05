import TextareaAutosize from 'react-textarea-autosize'
import { cn } from '@/lib/utils'
import { usePrompt } from '@/hooks/ui/usePrompt'
import { useThreads } from '@/hooks/threads/useThreads'
import { useCallback, useEffect, useRef, useState, memo } from 'react'
import { IconX } from '@tabler/icons-react'
import { useGeneralSetting } from '@/hooks/settings/useGeneralSetting'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { useAppState } from '@/hooks/settings/useAppState'
import type { ChatStatus } from 'ai'
import { useAssistant } from '@/hooks/chat/useAssistant'
import { useMemory } from '@/hooks/integrations/useMemory'
import { useLocalKnowledge } from '@/hooks/research/useLocalKnowledge'
import { useTools } from '@/hooks/tools/useTools'
import { useMessages } from '@/hooks/chat/useMessages'
import { useShallow } from 'zustand/react/shallow'
import { ExtensionTypeEnum, MCPExtension } from '@ax-studio/core'
import { ExtensionManager } from '@/lib/extension'
import { useChatSendHandler } from '@/hooks/chat/use-chat-send-handler'
import { useChatAttachments, NEW_THREAD_ATTACHMENT_KEY } from '@/hooks/chat/useChatAttachments'
import { useDocumentAttachmentHandler } from '@/hooks/chat/use-document-attachment-handler'
import { useImageAttachmentHandler } from '@/hooks/chat/use-image-attachment-handler'
import { ChatInputToolbar } from '@/containers/ChatInputToolbar'
import { ChatInputAttachments } from '@/components/ChatInputAttachments'
import { TokenCounter } from '@/components/TokenCounter'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Wrench, Globe, Atom, Code2 } from 'lucide-react'

type ChatInputProps = {
  className?: string
  showSpeedToken?: boolean
  model?: ThreadModel
  initialMessage?: boolean
  projectId?: string
  threadId?: string
  onSubmit?: (text: string) => void
  onStop?: () => void
  chatStatus?: ChatStatus
}

const ChatInput = memo(function ChatInput({
  className,
  initialMessage,
  projectId,
  threadId,
  onSubmit,
  onStop,
  chatStatus,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [rows, setRows] = useState(1)
  const [message, setMessage] = useState('')
  const [dropdownToolsAvailable, setDropdownToolsAvailable] = useState(false)
  const [tooltipToolsAvailable, setTooltipToolsAvailable] = useState(false)
  const [selectedAssistant, setSelectedAssistant] = useState<Assistant | undefined>(undefined)

  const abortControllers = useAppState((state) => state.abortControllers)
  const cancelToolCall = useAppState((state) => state.cancelToolCall)
  const tools = useAppState((state) => state.tools)
  const globalPrompt = usePrompt((state) => state.prompt)
  const setGlobalPrompt = usePrompt((state) => state.setPrompt)
  const currentThreadId = useThreads((state) => state.currentThreadId)
  const effectiveThreadId = threadId ?? currentThreadId
  const globalMemoryEnabled = useMemory((state) => state.memoryEnabled)
  const toggleMemoryGlobal = useMemory((state) => state.toggleMemory)
  const toggleMemoryForThread = useMemory((state) => state.toggleMemoryForThread)
  const memoryEnabledPerThread = useMemory((state) => state.memoryEnabledPerThread)
  const memoryCount = useMemory((state) => (state.memories['default'] || []).length)

  const isMemoryEnabled = effectiveThreadId
    ? (effectiveThreadId in memoryEnabledPerThread
        ? memoryEnabledPerThread[effectiveThreadId]
        : globalMemoryEnabled)
    : globalMemoryEnabled
  const toggleMemory = useCallback(() => {
    if (effectiveThreadId) {
      toggleMemoryForThread(effectiveThreadId)
    } else {
      toggleMemoryGlobal()
    }
  }, [effectiveThreadId, toggleMemoryForThread, toggleMemoryGlobal])

  const globalLocalKnowledgeEnabled = useLocalKnowledge((state) => state.localKnowledgeEnabled)
  const localKnowledgeEnabledPerThread = useLocalKnowledge((state) => state.localKnowledgeEnabledPerThread)
  const toggleLocalKnowledgeGlobal = useLocalKnowledge((state) => state.toggleLocalKnowledge)
  const toggleLocalKnowledgeForThread = useLocalKnowledge((state) => state.toggleLocalKnowledgeForThread)

  const isLocalKnowledgeEnabled = effectiveThreadId
    ? (effectiveThreadId in localKnowledgeEnabledPerThread
        ? localKnowledgeEnabledPerThread[effectiveThreadId]
        : globalLocalKnowledgeEnabled)
    : globalLocalKnowledgeEnabled
  const toggleLocalKnowledge = useCallback(() => {
    if (effectiveThreadId) {
      toggleLocalKnowledgeForThread(effectiveThreadId)
    } else {
      toggleLocalKnowledgeGlobal()
    }
  }, [effectiveThreadId, toggleLocalKnowledgeForThread, toggleLocalKnowledgeGlobal])
  const currentThread = useThreads((state) =>
    effectiveThreadId ? state.threads[effectiveThreadId] : state.getCurrentThread()
  )
  const updateCurrentThreadAssistant = useThreads((state) => state.updateCurrentThreadAssistant)
  const spellCheckChatInput = useGeneralSetting((state) => state.spellCheckChatInput)
  const tokenCounterCompact = useGeneralSetting((state) => state.tokenCounterCompact)
  const { t } = useTranslation()

  useTools()

  // ─── Document attachments ──────────────────────────────────────────────
  const attachmentsKey = effectiveThreadId || NEW_THREAD_ATTACHMENT_KEY
  const pendingAttachments = useChatAttachments(
    useCallback((state) => state.getAttachments(attachmentsKey), [attachmentsKey])
  )
  const transferAttachments = useChatAttachments((state) => state.transferAttachments)

  // Transfer attachments from __new-thread__ → real threadId when thread is created
  const lastTransferredThreadId = useRef<string | null>(null)
  useEffect(() => {
    if (
      currentThreadId &&
      lastTransferredThreadId.current !== currentThreadId
    ) {
      transferAttachments(NEW_THREAD_ATTACHMENT_KEY, currentThreadId)
      lastTransferredThreadId.current = currentThreadId
    }
  }, [currentThreadId, transferAttachments])

  const {
    handleAttachDocsIngest,
    handleRemoveAttachment,
    ingestingDocs,
  } = useDocumentAttachmentHandler({
    attachmentsKey,
    effectiveThreadId,
  })

  const selectedModel = useModelProvider((state) => state.selectedModel) ?? undefined
  const hasVisionSupport = selectedModel?.capabilities?.includes('vision') ?? false
  const {
    isDragOver,
    handleFileChange,
    handleImagePickerClick,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handlePaste,
  } = useImageAttachmentHandler({
    attachmentsKey,
    effectiveThreadId,
    fileInputRef,
    textareaRef,
    hasMmproj: hasVisionSupport,
    setMessage,
  })
  const assistants = useAssistant((state) => state.assistants)

  const threadMessages = useMessages(
    useShallow((state) =>
      effectiveThreadId ? state.messages[effectiveThreadId] : []
    )
  )

  const maxRows = 8

  const [localPrompt, setLocalPrompt] = useState('')
  const prompt = threadId ? localPrompt : globalPrompt
  const setPrompt = useCallback(
    (value: string) => {
      if (threadId) setLocalPrompt(value)
      else setGlobalPrompt(value)
    },
    [setGlobalPrompt, threadId]
  )

  // Focus management
  useEffect(() => {
    const handleFocusIn = () => {
      if (document.activeElement === textareaRef.current) setIsFocused(true)
    }
    const handleFocusOut = () => {
      if (document.activeElement !== textareaRef.current) setIsFocused(false)
    }
    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('focusout', handleFocusOut)
    return () => {
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('focusout', handleFocusOut)
    }
  }, [])

  useEffect(() => { textareaRef.current?.focus() }, [])
  useEffect(() => { textareaRef.current?.focus() }, [effectiveThreadId])

  useEffect(() => {
    if (chatStatus !== 'submitted') {
      setTimeout(() => { textareaRef.current?.focus() }, 10)
    }
  }, [chatStatus])

  useEffect(() => {
    if (tooltipToolsAvailable && dropdownToolsAvailable) setTooltipToolsAvailable(false)
  }, [dropdownToolsAvailable, tooltipToolsAvailable])

  const { handleSendMessage } = useChatSendHandler({
    onSubmit,
    projectId,
    assistants,
    selectedAssistant,
    setSelectedAssistant,
    setMessage,
    setPrompt,
  })

  const stopStreaming = useCallback(
    (tid: string) => {
      if (onStop) onStop()
      else abortControllers[tid]?.abort()
      cancelToolCall?.()
    },
    [abortControllers, cancelToolCall, onStop]
  )

  const hasActiveMCPServers = tools.length > 0
  const extensionManager = ExtensionManager.getInstance()
  const mcpExtension = extensionManager.get<MCPExtension>(ExtensionTypeEnum.MCP)
  const MCPToolComponent = mcpExtension?.getToolComponent?.()
  const isStreaming = chatStatus === 'submitted' || chatStatus === 'streaming'

  return (
    <div
      className="relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".jpg,.jpeg,.png,image/jpeg,image/png"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      <div className="relative">
        {isDragOver && (
          <div className="absolute inset-0 z-30 rounded-2xl border-2 border-dashed border-primary/60 bg-primary/5 pointer-events-none" />
        )}
        <div className="relative rounded-2xl">
          {/* Streaming glow border — spinning conic gradient */}
          {isStreaming && (
            <div className="absolute -inset-[1px] rounded-2xl overflow-hidden pointer-events-none z-0">
              <div
                className="absolute inset-0 streaming-glow-spin"
                style={{
                  background:
                    'conic-gradient(from 0deg, transparent 0%, #6366f1 20%, #8b5cf6 40%, transparent 60%)',
                }}
              />
              <div className="absolute inset-[1.5px] rounded-[14px] bg-white dark:bg-zinc-900" />
            </div>
          )}
          <div
            className={cn(
              'relative z-10 px-0 pb-10 border rounded-2xl border-input bg-white dark:bg-zinc-900 transition-shadow',
              isFocused && !isStreaming && 'ring-2 ring-primary/25 border-primary/30',
              isStreaming && 'border-transparent'
            )}
          >
            <TextareaAutosize
              ref={textareaRef}
              minRows={2}
              rows={1}
              maxRows={8}
              value={prompt}
              data-testid="chat-input"
              data-chat-input=""
              onChange={(e) => {
                setPrompt(e.target.value)
                const newRows = (e.target.value.match(/\n/g) || []).length + 1
                setRows(Math.min(newRows, maxRows))
              }}
              onKeyDown={(e) => {
                const isComposing = e.nativeEvent.isComposing || e.keyCode === 229
                if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
                  e.preventDefault()
                  if (!isStreaming && prompt.trim() && !ingestingDocs) {
                    handleSendMessage(prompt)
                  }
                }
              }}
              onPaste={(e) => {
                void handlePaste(e)
              }}
              placeholder={t('common:placeholder.chatInput')}
              aria-label={t('common:placeholder.chatInput')}
              autoFocus
              spellCheck={spellCheckChatInput}
              data-gramm={spellCheckChatInput}
              data-gramm_editor={spellCheckChatInput}
              data-gramm_grammarly={spellCheckChatInput}
              className={cn(
                'bg-transparent pt-4 w-full shrink-0 border-none resize-none outline-0 px-4 break-words text-[14px]',
                rows < maxRows && 'scrollbar-hide',
                className
              )}
            />

            {/* Document attachment preview tiles */}
            {pendingAttachments.length > 0 && (
              <ChatInputAttachments
                attachments={pendingAttachments}
                onRemove={handleRemoveAttachment}
              />
            )}
          </div>
        </div>

        <ChatInputToolbar
          isStreaming={isStreaming}
          prompt={prompt}
          textareaRef={textareaRef}
          setPrompt={setPrompt}
          selectedModel={selectedModel}
          projectId={projectId}
          initialMessage={initialMessage}
          selectedAssistant={selectedAssistant}
          setSelectedAssistant={setSelectedAssistant}
          currentThread={currentThread}
          updateCurrentThreadAssistant={updateCurrentThreadAssistant}
          effectiveThreadId={effectiveThreadId}
          assistants={assistants}
          tools={tools}
          hasActiveMCPServers={hasActiveMCPServers}
          MCPToolComponent={MCPToolComponent}
          dropdownToolsAvailable={dropdownToolsAvailable}
          setDropdownToolsAvailable={setDropdownToolsAvailable}
          tooltipToolsAvailable={tooltipToolsAvailable}
          setTooltipToolsAvailable={setTooltipToolsAvailable}
          isMemoryEnabled={isMemoryEnabled}
          toggleMemory={toggleMemory}
          memoryCount={memoryCount}
          isLocalKnowledgeEnabled={isLocalKnowledgeEnabled}
          toggleLocalKnowledge={toggleLocalKnowledge}
          tokenCounterCompact={tokenCounterCompact}
          threadMessages={threadMessages || []}
          stopStreaming={stopStreaming}
          handleSendMessage={handleSendMessage}
          onAttachDocuments={handleAttachDocsIngest}
          onAttachImages={handleImagePickerClick}
          ingestingDocs={ingestingDocs}
        />
      </div>

      {message && (
        <div className="-mt-0.5 mx-2 pb-2 px-3 pt-1.5 rounded-b-lg text-xs text-destructive transition-all duration-200 ease-in-out">
          <div className="flex items-center gap-1 justify-between">
            {message}
            <IconX
              className="size-3 text-muted-foreground cursor-pointer"
              onClick={() => setMessage('')}
            />
          </div>
        </div>
      )}

      {!tokenCounterCompact && !initialMessage && (threadMessages?.length > 0 || prompt.trim().length > 0) && (
        <div className="flex-1 w-full flex justify-start px-2">
          <TokenCounter messages={threadMessages || []} />
        </div>
      )}

      {/* Capability indicators + keyboard hints */}
      <div className="flex items-center gap-0.5 px-2 pt-1.5 pb-0.5">
        <button
          type="button"
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-md transition-colors text-[11px]',
            hasActiveMCPServers
              ? 'text-indigo-500 hover:bg-muted/60'
              : 'text-muted-foreground/30 hover:text-muted-foreground/50'
          )}
        >
          <Wrench className="size-3" />
          <span className="hidden sm:inline">Tools{hasActiveMCPServers ? ` (${tools.length})` : ''}</span>
        </button>
        <button
          type="button"
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-md transition-colors text-[11px]',
            selectedModel?.capabilities?.includes('web_search')
              ? 'text-cyan-500 hover:bg-muted/60'
              : 'text-muted-foreground/30 hover:text-muted-foreground/50'
          )}
        >
          <Globe className="size-3" />
          <span className="hidden sm:inline">Web</span>
        </button>
        <button
          type="button"
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-md transition-colors text-[11px]',
            selectedModel?.capabilities?.includes('reasoning')
              ? 'text-violet-500 hover:bg-muted/60'
              : 'text-muted-foreground/30 hover:text-muted-foreground/50'
          )}
        >
          <Atom className="size-3" />
          <span className="hidden sm:inline">Reasoning</span>
        </button>
        <button
          type="button"
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-md transition-colors text-[11px]',
            selectedModel
              ? 'text-emerald-500 hover:bg-muted/60'
              : 'text-muted-foreground/30 hover:text-muted-foreground/50'
          )}
        >
          <Code2 className="size-3" />
          <span className="hidden sm:inline">Code</span>
        </button>
        <div className="flex-1" />
        <span className="text-[11px] text-muted-foreground/30">
          ⏎ Send &nbsp;·&nbsp; ⇧⏎ Newline
        </span>
      </div>
    </div>
  )
})

export { ChatInput }
export default ChatInput
