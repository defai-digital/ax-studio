/**
 * useThreadChat — encapsulates message sending, regeneration, edit/delete,
 * message persistence on finish, context-size increase, and initial message
 * loading for a thread chat session.
 *
 * Returns pure callbacks + side-effects; no JSX.
 */

import { useCallback, useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { generateId } from 'ai'
import type { UIMessage } from '@ai-sdk/react'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useThreads } from '@/hooks/useThreads'
import { useMessages } from '@/hooks/useMessages'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useChatSessions } from '@/stores/chat-session-store'
import { useChatAttachments, NEW_THREAD_ATTACHMENT_KEY } from '@/hooks/useChatAttachments'
import { newUserThreadContent } from '@/lib/completion'
import { convertThreadMessagesToUIMessages } from '@/lib/messages'
import {
  ThreadMessage,
  MessageStatus,
  ChatCompletionRole,
  ContentType,
} from '@ax-studio/core'

type SendMessageFn = (args: { parts: any[]; id: string; metadata: unknown }) => void // eslint-disable-line @typescript-eslint/no-explicit-any
type RegenerateFn = (args?: { messageId?: string }) => void

export type ThreadChatParams = {
  threadId: string

  // From useChat
  sendMessage: SendMessageFn
  regenerate: RegenerateFn
  chatMessages: UIMessage[]
  setChatMessages: (msgs: UIMessage[]) => void

  // From useThreadMemory
  handleRememberCommand: (text: string) => boolean
  handleForgetCommand: (text: string) => boolean
  lastUserInputRef: React.MutableRefObject<string>
}

export type ThreadChatResult = {
  processAndSendMessage: (text: string) => Promise<void>
  persistMessageOnFinish: (message: UIMessage, contentParts: ThreadMessage['content']) => void
  handleRegenerate: (messageId?: string) => void
  handleEditMessage: (messageId: string, newText: string) => void
  handleDeleteMessage: (messageId: string) => void
  handleContextSizeIncrease: () => Promise<void>
}

export function useThreadChat({
  threadId,
  sendMessage,
  regenerate,
  chatMessages,
  setChatMessages,
  handleRememberCommand,
  handleForgetCommand,
  lastUserInputRef,
}: ThreadChatParams): ThreadChatResult {
  const serviceHub = useServiceHub()
  const thread = useThreads(useShallow((state) => state.threads[threadId]))
  const addMessage = useMessages((state) => state.addMessage)
  const updateMessage = useMessages((state) => state.updateMessage)
  const deleteMessage = useMessages((state) => state.deleteMessage)
  const setMessages = useMessages((state) => state.setMessages)
  const renameThread = useThreads((state) => state.renameThread)
  const selectedProvider = useModelProvider((state) => state.selectedProvider)
  const selectedModel = useModelProvider((state) => state.selectedModel)
  const getProviderByName = useModelProvider((state) => state.getProviderByName)

  // ─── Message loading ────────────────────────────────────────────────────────

  const loadedThreadRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    // Skip if chat already has messages (e.g., returning to a streaming conversation)
    const existingSession = useChatSessions.getState().sessions[threadId]
    if (
      existingSession?.chat.messages.length > 0 ||
      existingSession?.isStreaming ||
      loadedThreadRef.current === threadId
    ) {
      return
    }

    let ignore = false

    serviceHub
      .messages()
      .fetchMessages(threadId)
      .then((fetchedMessages) => {
        if (ignore) return
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
        if (!ignore) {
          console.error(`Failed to fetch messages for thread ${threadId}:`, error)
        }
      })

    return () => { ignore = true }
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
      if (pendingAttachments.some((a) => a.type === 'document' && (a.processing || (!a.processed && !a.error)))) {
        const maxWaitMs = 30_000
        const pollMs = 300
        const start = Date.now()
        while (Date.now() - start < maxWaitMs) {
          await new Promise((r) => setTimeout(r, pollMs))
          pendingAttachments = getAttachments()
          const stillProcessing = pendingAttachments.some(
            (a) => a.type === 'document' && (a.processing || (!a.processed && !a.error))
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
      const attachments = readyAttachments.length > 0 ? readyAttachments : undefined

      const userMessage = newUserThreadContent(
        threadId,
        text,
        attachments,
        messageId
      )
      addMessage(userMessage)

      // Build parts: text + any image file parts
      const parts: Array<{ type: string; text?: string; mediaType?: string; url?: string }> = [
        {
          type: 'text',
          text: userMessage.content[0].text?.value ?? text,
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
      thread,
      addMessage,
      renameThread,
      sendMessage,
      handleRememberCommand,
      handleForgetCommand,
      lastUserInputRef,
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
    },
    [threadId, addMessage, updateMessage]
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

          const messagesToDelete = currentLocalMessages.slice(deleteFromIndex + 1)
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

      const updatedChatMessages = chatMessages.map((msg) => {
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
      chatMessages,
      setChatMessages,
      regenerate,
    ]
  )

  // ─── Delete message ─────────────────────────────────────────────────────────

  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      deleteMessage(threadId, messageId)
      // Read fresh chat messages from the session store to avoid stale closure
      const currentMessages = useChatSessions.getState().sessions[threadId]?.chat.messages ?? []
      setChatMessages(currentMessages.filter((msg) => msg.id !== messageId))
    },
    [threadId, deleteMessage, setChatMessages]
  )

  // ─── Context size increase ──────────────────────────────────────────────────

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
    updateProvider(provider.provider, { models: updatedModels })

    await serviceHub.models().stopModel(selectedModel.id)
    setTimeout(() => {
      handleRegenerate()
    }, 1000)
  }, [selectedModel, selectedProvider, getProviderByName, serviceHub, handleRegenerate])

  return {
    processAndSendMessage,
    persistMessageOnFinish,
    handleRegenerate,
    handleEditMessage,
    handleDeleteMessage,
    handleContextSizeIncrease,
  }
}
