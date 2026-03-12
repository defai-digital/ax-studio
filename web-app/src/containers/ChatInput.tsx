import TextareaAutosize from 'react-textarea-autosize'
import { cn } from '@/lib/utils'
import { usePrompt } from '@/hooks/usePrompt'
import { useThreads } from '@/hooks/useThreads'
import { useCallback, useEffect, useRef, useState, memo } from 'react'
import { IconX } from '@tabler/icons-react'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useAppState } from '@/hooks/useAppState'
import { MovingBorder } from './MovingBorder'
import type { ChatStatus } from 'ai'
import { useAssistant } from '@/hooks/useAssistant'
import { useMemory } from '@/hooks/useMemory'
import { useTools } from '@/hooks/useTools'
import { useMessages } from '@/hooks/useMessages'
import { useShallow } from 'zustand/react/shallow'
import { ExtensionTypeEnum, MCPExtension } from '@ax-studio/core'
import { ExtensionManager } from '@/lib/extension'
import { useChatSendHandler } from '@/hooks/use-chat-send-handler'
import { ChatInputToolbar } from '@/containers/ChatInputToolbar'
import { TokenCounter } from '@/components/TokenCounter'
import { useTranslation } from '@/i18n/react-i18next-compat'

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
  const isMemoryEnabledForThread = useMemory((state) => state.isMemoryEnabledForThread)
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
  const currentThread = useThreads((state) =>
    effectiveThreadId ? state.threads[effectiveThreadId] : state.getCurrentThread()
  )
  const updateCurrentThreadAssistant = useThreads((state) => state.updateCurrentThreadAssistant)
  const spellCheckChatInput = useGeneralSetting((state) => state.spellCheckChatInput)
  const tokenCounterCompact = useGeneralSetting((state) => state.tokenCounterCompact)
  const { t } = useTranslation()

  useTools()

  const selectedModel = useModelProvider((state) => state.selectedModel)
  const assistants = useAssistant((state) => state.assistants)

  const threadMessages = useMessages(
    useShallow((state) =>
      effectiveThreadId ? state.messages[effectiveThreadId] : []
    )
  )

  const maxRows = 10

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
    <div className="relative overflow-hidden">
      <div className="relative">
        <div
          className={cn(
            'relative overflow-hidden p-0.5 rounded-3xl',
            isStreaming && 'opacity-70'
          )}
        >
          {isStreaming && (
            <div className="absolute inset-0">
              <MovingBorder rx="10%" ry="10%">
                <div className="h-100 w-100 bg-[radial-gradient(var(--app-primary),transparent_60%)]" />
              </MovingBorder>
            </div>
          )}

          <div
            className={cn(
              'relative z-20 px-0 pb-10 border rounded-3xl border-input bg-white dark:bg-input/30',
              isFocused && 'ring-1 ring-ring/50'
            )}
          >
            <TextareaAutosize
              ref={textareaRef}
              minRows={2}
              rows={1}
              maxRows={10}
              value={prompt}
              data-testid="chat-input"
              onChange={(e) => {
                setPrompt(e.target.value)
                const newRows = (e.target.value.match(/\n/g) || []).length + 1
                setRows(Math.min(newRows, maxRows))
              }}
              onKeyDown={(e) => {
                const isComposing = e.nativeEvent.isComposing || e.keyCode === 229
                if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
                  e.preventDefault()
                  if (!isStreaming && prompt.trim()) {
                    handleSendMessage(prompt)
                  }
                }
              }}
              placeholder={t('common:placeholder.chatInput')}
              autoFocus
              spellCheck={spellCheckChatInput}
              data-gramm={spellCheckChatInput}
              data-gramm_editor={spellCheckChatInput}
              data-gramm_grammarly={spellCheckChatInput}
              className={cn(
                'bg-transparent pt-4 w-full shrink-0 border-none resize-none outline-0 px-4 break-words',
                rows < maxRows && 'scrollbar-hide',
                className
              )}
            />
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
          tokenCounterCompact={tokenCounterCompact}
          threadMessages={threadMessages || []}
          stopStreaming={stopStreaming}
          handleSendMessage={handleSendMessage}
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
    </div>
  )
})

export { ChatInput }
export default ChatInput
