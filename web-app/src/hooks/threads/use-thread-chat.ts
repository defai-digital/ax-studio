/**
 * useThreadChat — encapsulates message sending, regeneration, edit/delete,
 * message persistence on finish, context-size increase, and initial message
 * loading for a thread chat session.
 *
 * Returns pure callbacks + side-effects; no JSX.
 */

import { useCallback, useEffect, useRef } from 'react'
import { generateId } from 'ai'
import type { UIMessage } from '@ai-sdk/react'

// Message parts for chat messages (Vercel AI SDK format)
type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'file'; mediaType: string; url: string }
import { useServiceHub } from '@/hooks/useServiceHub'
import { useThreads } from '@/hooks/threads/useThreads'
import { useMessages } from '@/hooks/chat/useMessages'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { useChatSessions } from '@/stores/chat-session-store'
import {
  useChatAttachments,
  NEW_THREAD_ATTACHMENT_KEY,
} from '@/hooks/chat/useChatAttachments'
import { newUserThreadContent } from '@/lib/completion'
import { getModelContextLength } from '@/lib/models'
import { convertThreadMessagesToUIMessages } from '@/lib/messages'
import {
  ThreadMessage,
  MessageStatus,
  ChatCompletionRole,
  ContentType,
} from '@ax-studio/core'

type SendMessageFn = (args: {
  parts: MessagePart[]
  id: string
  metadata: unknown
}) => void  
type RegenerateFn = (args?: { messageId?: string }) => void

export type ThreadChatParams = {
  threadId: string
  threadModel?: ThreadModel

  // From useChat
  sendMessage: SendMessageFn
  regenerate: RegenerateFn
  chatMessages: UIMessage[]
  setChatMessages: (msgs: UIMessage[]) => void

  // From useThreadMemory
  handleRememberCommand: (text: string) => boolean
  handleForgetCommand: (text: string) => boolean
  lastUserInputRef: React.MutableRefObject<string>
  prepareLocalKnowledge?: (text: string) => Promise<string>
}

export type ThreadChatResult = {
  processAndSendMessage: (text: string) => Promise<void>
  persistMessageOnFinish: (
    message: UIMessage,
    contentParts: ThreadMessage['content']
  ) => void
  handleRegenerate: (messageId?: string) => void
  handleEditMessage: (messageId: string, newText: string) => void
  handleDeleteMessage: (messageId: string) => void
  handleContextSizeIncrease: () => Promise<void>
}

export function useThreadChat({
  threadId,
  threadModel,
  sendMessage,
  regenerate,
  setChatMessages,
  handleRememberCommand,
  handleForgetCommand,
  lastUserInputRef,
  prepareLocalKnowledge,
}: ThreadChatParams): ThreadChatResult {
  const serviceHub = useServiceHub()
  const addMessage = useMessages((state) => state.addMessage)
  const updateMessage = useMessages((state) => state.updateMessage)
  const deleteMessage = useMessages((state) => state.deleteMessage)
  const setMessages = useMessages((state) => state.setMessages)
  const renameThread = useThreads((state) => state.renameThread)
  const updateThreadTimestamp = useThreads((state) => state.updateThreadTimestamp)
  const selectedProvider = useModelProvider((state) => state.selectedProvider)
  const selectedModel = useModelProvider((state) => state.selectedModel)
  const getProviderByName = useModelProvider((state) => state.getProviderByName)

  // ─── Message loading ────────────────────────────────────────────────────────

  const loadedThreadRef = useRef<string | undefined>(undefined)

  // Tracks unmount / thread-change so long-running tasks (e.g. the 30s
  // attachment-processing poll) can bail out instead of blindly sending a
  // message to a thread the user has navigated away from.
  const unmountedRef = useRef(false)
  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
    }
  }, [threadId])

  useEffect(() => {
    const existingSession = useChatSessions.getState().sessions[threadId]
    if (
      (existingSession?.chat?.messages?.length ?? 0) > 0 ||
      existingSession?.isStreaming ||
      loadedThreadRef.current === threadId
    ) {
      return
    }

    const controller = new AbortController()

    serviceHub
      .messages()
      .fetchMessages(threadId)
      .then((fetchedMessages) => {
        if (controller.signal.aborted) return
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

          setMessages(threadId, messagesToSet)
          const uiMessages = convertThreadMessagesToUIMessages(messagesToSet)
          setChatMessages(uiMessages)
          loadedThreadRef.current = threadId
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.error(
            `Failed to fetch messages for thread ${threadId}:`,
            error
          )
        }
      })

    return () => {
      controller.abort()
    }
  }, [threadId, serviceHub, setMessages, setChatMessages])

  // ─── Send message ───────────────────────────────────────────────────────────

  const processAndSendMessage = useCallback(
    async (text: string) => {
      const normalizedText = text.trim()
      lastUserInputRef.current = normalizedText

      // Handle /remember and /forget commands
      if (handleRememberCommand(normalizedText)) return
      if (handleForgetCommand(normalizedText)) return

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

      const messageId = generateId()

      // Grab any pending attachments for this thread.
      // If documents are still processing (async MCP calls in flight), wait
      // for them to finish before sending so the model receives the content.
      const attachmentsKey = threadId || NEW_THREAD_ATTACHMENT_KEY

      const getAttachments = () =>
        useChatAttachments.getState().getAttachments(attachmentsKey)

      let pendingAttachments = getAttachments()

      // Wait up to 30 seconds for in-flight document processing to complete
      if (
        pendingAttachments.some(
          (a) =>
            a.type === 'document' &&
            (a.processing || (!a.processed && !a.error))
        )
      ) {
        const maxWaitMs = 30_000
        const pollMs = 300
        const start = Date.now()
        while (Date.now() - start < maxWaitMs) {
          // Bail out if the user navigated away mid-poll, otherwise we'd
          // send this message to a thread they can no longer see.
          if (unmountedRef.current) return
          await new Promise((r) => setTimeout(r, pollMs))
          if (unmountedRef.current) return
          pendingAttachments = getAttachments()
          const stillProcessing = pendingAttachments.some(
            (a) =>
              a.type === 'document' &&
              (a.processing || (!a.processed && !a.error))
          )
          if (!stillProcessing) break
        }
        // Re-read after waiting
        pendingAttachments = getAttachments()
      }

      // Only include fully processed attachments
      const readyAttachments = pendingAttachments.filter((a) => {
        if (a.type === 'image') return true
        if (a.type === 'document') {
          return a.processed === true && (a.inlineContent || a.id)
        }
        return false
      })
      const attachments =
        readyAttachments.length > 0 ? readyAttachments : undefined

      const knowledgeContext = prepareLocalKnowledge
        ? await prepareLocalKnowledge(normalizedText)
        : ''
      const modelText = knowledgeContext
        ? `${text}${knowledgeContext}`
        : text

      const userMessage = newUserThreadContent(
        threadId,
        text,
        attachments,
        messageId
      )
      addMessage(userMessage)
      updateThreadTimestamp(threadId)

      // Build parts: text + any image file parts
      const parts: MessagePart[] = [
        {
          type: 'text',
          text: modelText,
        },
      ]

      // Add image attachments as file parts for vision models
      if (attachments) {
        for (const att of attachments) {
          if (att.type === 'image' && att.base64 && att.mimeType) {
            parts.push({
              type: 'file',
              mediaType: att.mimeType,
              url: `data:${att.mimeType};base64,${att.base64}`,
            })
          }
        }
      }

      sendMessage({
        parts,
        id: messageId,
        metadata: userMessage.metadata,
      })

      // Clear attachments after sending
      if (pendingAttachments.length > 0) {
        useChatAttachments.getState().clearAttachments(attachmentsKey)
      }
    },
    [
      threadId,
      addMessage,
      updateThreadTimestamp,
      renameThread,
      sendMessage,
      handleRememberCommand,
      handleForgetCommand,
      lastUserInputRef,
      prepareLocalKnowledge,
    ]
  )

  // ─── Message persistence (called from onFinish) ─────────────────────────────
  //
  // Accepts the caller's already-extracted contentParts so we use the same
  // array that processMemoryOnFinish mutated (stripped <memory_extract> tags).
  // Re-extracting from `message` would re-introduce the raw tags.

  const persistMessageOnFinish = useCallback(
    (message: UIMessage, contentParts: ThreadMessage['content']) => {
      if (contentParts.length === 0) return

      const assistantMessage = {
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
      } as unknown as ThreadMessage

      const existingMessages = useMessages.getState().getMessages(threadId)
      const existingMessage = existingMessages.find((m) => m.id === message.id)
      if (existingMessage) {
        updateMessage(assistantMessage)
      } else {
        addMessage(assistantMessage)
      }
      updateThreadTimestamp(threadId)
    },
    [threadId, addMessage, updateMessage, updateThreadTimestamp]
  )

  // ─── Regenerate ─────────────────────────────────────────────────────────────

  const handleRegenerate = useCallback(
    (messageId?: string) => {
      const currentLocalMessages = useMessages.getState().getMessages(threadId)

      if (messageId) {
        const messageIndex = currentLocalMessages.findIndex(
          (m) => m.id === messageId
        )
        if (messageIndex !== -1) {
          const selectedMessage = currentLocalMessages[messageIndex]

          let deleteFromIndex = messageIndex
          if (selectedMessage.role === 'assistant') {
            for (let i = messageIndex - 1; i >= 0; i--) {
              if (currentLocalMessages[i].role === 'user') {
                deleteFromIndex = i
                break
              }
            }
          }

          const messagesToDelete = currentLocalMessages.slice(
            deleteFromIndex + 1
          )
          if (messagesToDelete.length > 0) {
            messagesToDelete.forEach((msg) => {
              deleteMessage(threadId, msg.id)
            })
          }
        }
      }

      regenerate(messageId ? { messageId } : undefined)
    },
    [threadId, deleteMessage, regenerate]
  )

  // ─── Edit message ───────────────────────────────────────────────────────────

  const handleEditMessage = useCallback(
    (messageId: string, newText: string) => {
      const currentLocalMessages = useMessages.getState().getMessages(threadId)
      const messageIndex = currentLocalMessages.findIndex(
        (m) => m.id === messageId
      )
      if (messageIndex === -1) return

      const originalMessage = currentLocalMessages[messageIndex]
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

      // Read the current chat messages from the session store rather
      // than closing over the `chatMessages` prop. The prop changes on
      // every streaming token, which previously recreated
      // `handleEditMessage` on every token and cascaded re-renders
      // through every MessageItem in the thread.
      const currentChatMessages =
        useChatSessions.getState().sessions[threadId]?.chat?.messages ?? []
      const updatedChatMessages = currentChatMessages.map((msg) => {
        if (msg.id === messageId) {
          return { ...msg, parts: [{ type: 'text' as const, text: newText }] }
        }
        return msg
      })
      setChatMessages(updatedChatMessages)

      if (updatedMessage.role === 'assistant') return

      const messagesToDelete = currentLocalMessages.slice(messageIndex + 1)
      messagesToDelete.forEach((msg) => {
        deleteMessage(threadId, msg.id)
      })

      regenerate({ messageId })
    },
    [
      threadId,
      updateMessage,
      deleteMessage,
      setChatMessages,
      regenerate,
    ]
  )

  // ─── Delete message ─────────────────────────────────────────────────────────

  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      deleteMessage(threadId, messageId)
      // Read fresh chat messages from the session store to avoid stale closure
      const currentMessages =
        useChatSessions.getState().sessions[threadId]?.chat?.messages ?? []
      setChatMessages(currentMessages.filter((msg) => msg.id !== messageId))
    },
    [threadId, deleteMessage, setChatMessages]
  )

  // ─── Context size increase ──────────────────────────────────────────────────

  // Keep a handle on the pending regenerate timer so navigation / unmount
  // cancels it instead of firing handleRegenerate() on an unmounted component.
  const contextIncreaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contextIncreaseAbortRef = useRef<AbortController | null>(null)
  useEffect(() => {
    return () => {
      if (contextIncreaseTimerRef.current) {
        clearTimeout(contextIncreaseTimerRef.current)
        contextIncreaseTimerRef.current = null
      }
      contextIncreaseAbortRef.current?.abort()
    }
  }, [])

  const handleContextSizeIncrease = useCallback(async () => {
    const updateProvider = useModelProvider.getState().updateProvider
    const providerName = threadModel?.provider ?? selectedProvider
    const modelId = threadModel?.id ?? selectedModel?.id
    if (!modelId) return

    const provider = getProviderByName(providerName)
    if (!provider) return

    const modelIndex = provider.models.findIndex(
      (m) => m.id === modelId
    )
    if (modelIndex === -1) return

    const model = provider.models[modelIndex]
    const currentCtxLen = getModelContextLength(model) ?? 8192
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
    updateProvider(provider.provider, { models: updatedModels })

    contextIncreaseAbortRef.current?.abort()
    const controller = new AbortController()
    contextIncreaseAbortRef.current = controller

    await serviceHub.models().stopModel(modelId, provider.provider)
    if (controller.signal.aborted) return
    if (contextIncreaseTimerRef.current) {
      clearTimeout(contextIncreaseTimerRef.current)
    }
    contextIncreaseTimerRef.current = setTimeout(() => {
      contextIncreaseTimerRef.current = null
      if (unmountedRef.current || controller.signal.aborted) return
      handleRegenerate()
    }, 1000)
  }, [
    selectedModel,
    selectedProvider,
    threadModel,
    getProviderByName,
    serviceHub,
    handleRegenerate,
  ])

  return {
    processAndSendMessage,
    persistMessageOnFinish,
    handleRegenerate,
    handleEditMessage,
    handleDeleteMessage,
    handleContextSizeIncrease,
  }
}
