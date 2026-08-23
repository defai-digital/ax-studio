import TextareaAutosize from 'react-textarea-autosize'
import { cn } from '@/lib/utils'
import { usePrompt } from '@/hooks/ui/usePrompt'
import { useThreads } from '@/hooks/threads/useThreads'
import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import { useGeneralSetting } from '@/hooks/settings/useGeneralSetting'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { useAppState } from '@/hooks/settings/useAppState'
import type { ChatStatus } from 'ai'
import { useMessages } from '@/hooks/chat/useMessages'
import { useShallow } from 'zustand/react/shallow'
import { useChatSendHandler } from '@/hooks/chat/use-chat-send-handler'
import {
  useChatAttachments,
  NEW_THREAD_ATTACHMENT_KEY,
} from '@/hooks/chat/useChatAttachments'
import { useDocumentAttachmentHandler } from '@/hooks/chat/use-document-attachment-handler'
import { useImageAttachmentHandler } from '@/hooks/chat/use-image-attachment-handler'
import { ChatInputToolbar } from '@/components/chat/ChatInputToolbar'
import { TemporaryChatNotice } from '@/components/chat/TemporaryChatNotice'
import { useTemporaryChat } from '@/hooks/chat/useTemporaryChat'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { DropdownModelProvider } from '@/containers/DropdownModelProvider'
import { ChatInputAttachments } from '@/components/ChatInputAttachments'
import { TokenCounter } from '@/components/TokenCounter'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { X } from 'lucide-react'
import { COMPOSER_FOCUS_EVENT } from '@/types/events'
import { resolveEffectiveSelectedModel } from '@/lib/chat/selected-model'
import { hasSendableAttachment } from '@/lib/attachments/sendable'

type ChatInputProps = {
  className?: string
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
  model,
  onSubmit,
  onStop,
  chatStatus,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isFocused, setIsFocused] = useState(false)
  const [rows, setRows] = useState(1)
  const [message, setMessage] = useState('')

  // Don't subscribe to the whole `abortControllers` record — every
  // streaming token on any thread would re-render ChatInput. We only
  // need the current thread's controller at stop-time, so read from the
  // store snapshot inside `stopStreaming` below.
  const globalPrompt = usePrompt((state) => state.prompt)
  const setGlobalPrompt = usePrompt((state) => state.setPrompt)
  const currentThreadId = useThreads((state) => state.currentThreadId)
  const effectiveThreadId = threadId ?? currentThreadId

  const currentThread = useThreads((state) =>
    effectiveThreadId
      ? state.threads[effectiveThreadId]
      : state.getCurrentThread()
  )
  const temporaryChatEnabled = useTemporaryChat(
    (state) => state.temporaryChatEnabled
  )
  const toggleTemporaryChat = useTemporaryChat(
    (state) => state.toggleTemporaryChat
  )
  // Viewing the in-memory temporary thread itself (as opposed to composing a
  // new chat with the toggle on).
  const isTemporaryThread =
    effectiveThreadId === TEMPORARY_CHAT_ID ||
    Boolean(currentThread?.metadata?.isTemporary)
  const spellCheckChatInput = useGeneralSetting(
    (state) => state.spellCheckChatInput
  )
  const tokenCounterCompact = useGeneralSetting(
    (state) => state.tokenCounterCompact
  )
  const { t } = useTranslation()

  // ─── Document attachments ──────────────────────────────────────────────
  const attachmentsKey = effectiveThreadId || NEW_THREAD_ATTACHMENT_KEY
  const pendingAttachments = useChatAttachments(
    useCallback(
      (state) => state.getAttachments(attachmentsKey),
      [attachmentsKey]
    )
  )
  const transferAttachments = useChatAttachments(
    (state) => state.transferAttachments
  )

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

  const { handleAttachDocsIngest, handleRemoveAttachment, ingestingDocs } =
    useDocumentAttachmentHandler({
      attachmentsKey,
      effectiveThreadId,
    })

  const providers = useModelProvider((state) => state.providers)
  const selectedProvider = useModelProvider((state) => state.selectedProvider)
  const selectedModelFromStore =
    useModelProvider((state) => state.selectedModel) ?? undefined
  const selectedModel = resolveEffectiveSelectedModel({
    model,
    providers,
    selectedProvider,
    selectedModelFromStore,
  })
  const hasVisionSupport =
    selectedModel?.capabilities?.includes('vision') ?? false
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

  // External prefill (e.g. artifact "Revise selection" via usePrompt.setPrompt):
  // thread composers keep their text in localPrompt, so adopt global prompt
  // writes, clear the global, and focus the textarea.
  useEffect(() => {
    if (threadId && globalPrompt) {
      setLocalPrompt(globalPrompt)
      setGlobalPrompt('')
      textareaRef.current?.focus()
    }
  }, [threadId, globalPrompt, setGlobalPrompt])

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

  useEffect(() => {
    textareaRef.current?.focus()
  }, [effectiveThreadId])

  // Global wake hotkey: the app navigates home and dispatches this event so
  // the mounted composer grabs focus even when it was already mounted.
  useEffect(() => {
    const handleComposerFocus = () => textareaRef.current?.focus()
    window.addEventListener(COMPOSER_FOCUS_EVENT, handleComposerFocus)
    return () => {
      window.removeEventListener(COMPOSER_FOCUS_EVENT, handleComposerFocus)
    }
  }, [])

  const { handleSendMessage } = useChatSendHandler({
    onSubmit,
    projectId,
    selectedModel,
    attachmentsKey,
    setMessage,
    setPrompt,
  })

  const canSubmitAttachments = hasSendableAttachment(pendingAttachments)

  const submitCurrentPrompt = useCallback(() => {
    const currentPrompt = textareaRef.current?.value ?? prompt
    if (ingestingDocs) return
    if (!currentPrompt.trim() && !canSubmitAttachments) return
    void handleSendMessage(currentPrompt)
  }, [canSubmitAttachments, handleSendMessage, ingestingDocs, prompt])

  const stopStreaming = useCallback(
    (tid: string) => {
      if (onStop) onStop()
      else {
        const { abortControllers } = useAppState.getState()
        if (Object.prototype.hasOwnProperty.call(abortControllers, tid)) {
          abortControllers[tid]?.abort()
        }
      }
    },
    [onStop]
  )

  const isStreaming = chatStatus === 'submitted' || chatStatus === 'streaming'

  // Model selector, rendered inside the composer toolbar. `useLastUsedModel`
  // reproduces the previous per-context header behaviour exactly: on the new-chat
  // home it defaulted to the last-used model; in threads and projects it did not.
  const modelSelector = useMemo(
    () => (
      <DropdownModelProvider
        model={model}
        useLastUsedModel={Boolean(initialMessage && !projectId)}
      />
    ),
    [model, initialMessage, projectId]
  )

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
      {(isTemporaryThread || (initialMessage && temporaryChatEnabled)) && (
        <TemporaryChatNotice />
      )}
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
                    'conic-gradient(from 0deg, transparent 0%, var(--primary) 20%, var(--brand-to) 40%, transparent 60%)',
                }}
              />
              <div className="absolute inset-[1.5px] rounded-[14px] bg-white dark:bg-zinc-900" />
            </div>
          )}
          <div
            className={cn(
              'relative z-10 px-0 pb-10 border rounded-2xl border-input bg-white dark:bg-zinc-900 transition-shadow',
              isFocused &&
                !isStreaming &&
                'ring-2 ring-primary/25 border-primary/30',
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
                const isComposing =
                  e.nativeEvent.isComposing || e.keyCode === 229
                if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
                  e.preventDefault()
                  if (!isStreaming) {
                    submitCurrentPrompt()
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
          modelSelector={modelSelector}
          selectedModel={selectedModel}
          projectId={projectId}
          initialMessage={initialMessage}
          effectiveThreadId={effectiveThreadId}
          temporaryChatEnabled={temporaryChatEnabled}
          onToggleTemporaryChat={toggleTemporaryChat}
          tokenCounterCompact={tokenCounterCompact}
          threadMessages={threadMessages || []}
          stopStreaming={stopStreaming}
          handleSendMessage={handleSendMessage}
          submitCurrentPrompt={submitCurrentPrompt}
          onAttachDocuments={handleAttachDocsIngest}
          onAttachImages={handleImagePickerClick}
          ingestingDocs={ingestingDocs}
        />
      </div>

      {message && (
        <div
          role="alert"
          className="-mt-0.5 mx-2 pb-2 px-3 pt-1.5 rounded-b-lg text-xs text-destructive transition-all duration-200 ease-in-out"
        >
          <div className="flex items-center gap-1 justify-between">
            {message}
            <button
              type="button"
              className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t('common:close')}
              onClick={() => setMessage('')}
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      {!tokenCounterCompact &&
        !initialMessage &&
        (threadMessages?.length > 0 || prompt.trim().length > 0) && (
          <div className="flex-1 w-full flex justify-start px-2">
            <TokenCounter
              messages={threadMessages || []}
              model={selectedModel}
            />
          </div>
        )}
    </div>
  )
})

export { ChatInput }
