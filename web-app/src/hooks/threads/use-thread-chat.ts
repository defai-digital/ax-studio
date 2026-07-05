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
import {
  newAssistantThreadContent,
  newUserThreadContent,
} from '@/lib/completion'
import { getModelContextLength } from '@/lib/models'
import { convertThreadMessagesToUIMessages } from '@/lib/messages'
import { getVersionMeta, selectVisibleMessages } from '@/lib/messages/versions'
import {
  runAxBiDashboardWorkflow,
  runAxBiExistingDatasetChartWorkflow,
  runAxBiSdkPromptWorkflow,
} from '@/lib/ax-bi/dashboard-workflow'
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

  prepareLocalKnowledge?: (text: string) => Promise<{
    context: string
    retrieval?: {
      searched: boolean
      extracted: boolean
      source?: string
      error?: string
    }
  }>
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
  handleSwitchVersion: (groupId: string, direction: 'prev' | 'next') => void
  handleContextSizeIncrease: () => Promise<void>
}

export function useThreadChat({
  threadId,
  threadModel,
  sendMessage,
  regenerate,
  chatMessages,
  setChatMessages,
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

  // Set by handleRegenerate right before calling the AI SDK's regenerate(),
  // and consumed once (one-shot) by persistMessageOnFinish to tag the newly
  // generated message as the next version in the group. Cleared whenever a
  // fresh user message is sent, so a regenerate that's stopped mid-stream
  // (which never reaches persistMessageOnFinish) can't bleed into a later,
  // unrelated message.
  const pendingVersionTagRef = useRef<{
    groupId: string
    versionIndex: number
  } | null>(null)

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
          const uiMessages = convertThreadMessagesToUIMessages(
            selectVisibleMessages(messagesToSet)
          )
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

      // A fresh user turn always invalidates any pending regenerate-version
      // tag (e.g. one left over from a regenerate that was stopped before
      // persistMessageOnFinish ever fired).
      pendingVersionTagRef.current = null

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

      const localKnowledge = prepareLocalKnowledge
        ? await prepareLocalKnowledge(normalizedText)
        : { context: '' }
      const knowledgeContext = localKnowledge.context
      
      // Add file path information for document attachments so the LLM can reference them
      const docAttachments = attachments?.filter(
        (att) => att.type === 'document' && att.path
      ) ?? []
      const filePathInfo = docAttachments.length > 0
        ? `\n\n[Attached files: ${docAttachments.map((a) => `${a.name} at ${a.path}`).join(', ')}]`
        : ''
      
      const modelText = knowledgeContext
        ? `${text}${knowledgeContext}${filePathInfo}`
        : `${text}${filePathInfo}`

      const userMessage = newUserThreadContent(
        threadId,
        text,
        attachments,
        messageId
      )
      if (localKnowledge.retrieval) {
        userMessage.metadata = {
          ...(userMessage.metadata as Record<string, unknown> | undefined),
          localKnowledgeRetrieval: localKnowledge.retrieval,
        } as ThreadMessage['metadata']
      }
      addMessage(userMessage)
      updateThreadTimestamp(threadId)

      let directAxBiResult:
        | Awaited<ReturnType<typeof runAxBiExistingDatasetChartWorkflow>>
        | Awaited<ReturnType<typeof runAxBiDashboardWorkflow>>
        | Awaited<ReturnType<typeof runAxBiSdkPromptWorkflow>>

      directAxBiResult = await runAxBiExistingDatasetChartWorkflow({
        prompt: normalizedText,
        serviceHub,
      })
      if (!directAxBiResult.handled) {
        directAxBiResult = await runAxBiDashboardWorkflow({
          prompt: normalizedText,
          attachments: pendingAttachments,
          serviceHub,
        })
      }
      if (!directAxBiResult.handled) {
        directAxBiResult = await runAxBiSdkPromptWorkflow({
          prompt: normalizedText,
          serviceHub,
        })
      }

      if (directAxBiResult.handled) {
        const assistantMessage = newAssistantThreadContent(
          threadId,
          directAxBiResult.message,
          {
            axBi: {
              sdk: 'plan' in directAxBiResult,
              dashboardUrl:
                'dashboardUrl' in directAxBiResult
                  ? directAxBiResult.dashboardUrl
                  : undefined,
              chartUrl:
                'chartUrl' in directAxBiResult
                  ? directAxBiResult.chartUrl
                  : undefined,
            },
          },
        )
        addMessage(assistantMessage)
        updateThreadTimestamp(threadId)
        setChatMessages(
          convertThreadMessagesToUIMessages(
            selectVisibleMessages(useMessages.getState().getMessages(threadId))
          )
        )
        if (pendingAttachments.length > 0) {
          useChatAttachments.getState().clearAttachments(attachmentsKey)
        }
        return
      }

      // Request parts include hidden local-knowledge context for the model.
      // Visible parts keep the user's chat bubble clean.
      const requestParts: MessagePart[] = [
        {
          type: 'text',
          text: modelText,
        },
      ]
      const visibleParts: MessagePart[] = [
        {
          type: 'text',
          text: userMessage.content[0].text?.value ?? text,
        },
      ]

      // Add image attachments as file parts for vision models
      if (attachments) {
        for (const att of attachments) {
          if (att.type === 'image' && att.base64 && att.mimeType) {
            const filePart: MessagePart = {
              type: 'file',
              mediaType: att.mimeType,
              url: `data:${att.mimeType};base64,${att.base64}`,
            }
            requestParts.push(filePart)
            visibleParts.push(filePart)
          }
        }
      }

      // Preserve document attachment metadata so workflows (e.g. AX-BI) can
      // access the original file paths even though documents are inlined as
      // text rather than added as file parts.
      const existingMeta = userMessage.metadata as Record<string, unknown> ?? {}
      const messageMeta = docAttachments.length > 0
        ? { ...existingMeta, document_attachments: docAttachments.map((a) => ({ name: a.name, path: a.path, fileType: a.fileType })) }
        : existingMeta

      sendMessage({
        parts: requestParts,
        id: messageId,
        metadata: messageMeta,
      })

      if (knowledgeContext) {
        queueMicrotask(() => {
          const liveMessages =
            useChatSessions.getState().sessions[threadId]?.chat?.messages ??
            chatMessages
          setChatMessages(
            liveMessages.map((message) =>
              message.id === messageId
                ? {
                    ...message,
                    metadata: userMessage.metadata as Record<string, unknown>,
                    parts: visibleParts,
                  }
                : message
            )
          )
        })
      }

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
      chatMessages,
      setChatMessages,
      prepareLocalKnowledge,
      serviceHub,
    ]
  )

  // ─── Message persistence (called from onFinish) ─────────────────────────────

  const persistMessageOnFinish = useCallback(
    (message: UIMessage, contentParts: ThreadMessage['content']) => {
      if (contentParts.length === 0) return

      // Consume (one-shot) any pending regenerate-version tag so this newly
      // generated message takes its place as the next version in the group.
      const pendingTag = pendingVersionTagRef.current
      pendingVersionTagRef.current = null
      const baseMetadata = (message.metadata || {}) as Record<string, unknown>
      const metadata = pendingTag
        ? {
            ...baseMetadata,
            versionGroupId: pendingTag.groupId,
            versionIndex: pendingTag.versionIndex,
            isActiveVersion: true,
          }
        : baseMetadata

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
        metadata,
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
  //
  // Regenerating no longer deletes the superseded response — it marks the old
  // tail inactive (tagging it as version 1 the first time) and tags the newly
  // generated message, once persisted, as the next version in the same group
  // (keyed by the preceding user message's id). Both versions stay in
  // storage; handleSwitchVersion flips which one is visible.

  const handleRegenerate = useCallback(
    (messageId?: string) => {
      const allMessages = useMessages.getState().getMessages(threadId)
      const visibleMessages = selectVisibleMessages(allMessages)

      if (messageId) {
        const messageIndex = visibleMessages.findIndex(
          (m) => m.id === messageId
        )
        if (messageIndex !== -1) {
          const selectedMessage = visibleMessages[messageIndex]

          let anchorIndex = messageIndex
          if (selectedMessage.role === 'assistant') {
            for (let i = messageIndex - 1; i >= 0; i--) {
              if (visibleMessages[i].role === 'user') {
                anchorIndex = i
                break
              }
            }
          }

          const oldTail = visibleMessages.slice(anchorIndex + 1)

          if (oldTail.length > 0) {
            const groupId = visibleMessages[anchorIndex].id
            const oldTailMeta = getVersionMeta(oldTail[0])
            const oldTailIndex =
              oldTailMeta.versionGroupId === groupId &&
              typeof oldTailMeta.versionIndex === 'number'
                ? oldTailMeta.versionIndex
                : 1

            const existingIndices = allMessages
              .map((m) => {
                const meta = getVersionMeta(m)
                return meta.versionGroupId === groupId
                  ? meta.versionIndex
                  : undefined
              })
              .filter((v): v is number => typeof v === 'number')
            const nextIndex = Math.max(oldTailIndex, ...existingIndices, 0) + 1

            oldTail.forEach((msg) => {
              updateMessage({
                ...msg,
                metadata: {
                  ...(msg.metadata as Record<string, unknown> | undefined),
                  versionGroupId: groupId,
                  versionIndex: oldTailIndex,
                  isActiveVersion: false,
                },
              })
            })

            pendingVersionTagRef.current = { groupId, versionIndex: nextIndex }
          }
        }
      }

      regenerate(messageId ? { messageId } : undefined)
    },
    [threadId, updateMessage, regenerate]
  )

  // ─── Switch version ─────────────────────────────────────────────────────────
  //
  // Flips which stored version of a group is active — no new generation, just
  // toggling isActiveVersion and rebuilding the visible chatMessages mirror.

  const handleSwitchVersion = useCallback(
    (groupId: string, direction: 'prev' | 'next') => {
      const allMessages = useMessages.getState().getMessages(threadId)
      const groupMessages = allMessages.filter(
        (m) => getVersionMeta(m).versionGroupId === groupId
      )
      if (groupMessages.length === 0) return

      const indices = Array.from(
        new Set(
          groupMessages
            .map((m) => getVersionMeta(m).versionIndex)
            .filter((v): v is number => typeof v === 'number')
        )
      ).sort((a, b) => a - b)
      if (indices.length < 2) return

      const activeMessage = groupMessages.find(
        (m) => getVersionMeta(m).isActiveVersion === true
      )
      const activeVersionIndex = getVersionMeta(
        activeMessage ?? groupMessages[0]
      ).versionIndex
      const activeIndex =
        typeof activeVersionIndex === 'number'
          ? activeVersionIndex
          : indices[indices.length - 1]

      const pos = indices.indexOf(activeIndex)
      if (pos === -1) return

      const targetPos =
        direction === 'next'
          ? Math.min(pos + 1, indices.length - 1)
          : Math.max(pos - 1, 0)
      const targetIndex = indices[targetPos]
      if (targetIndex === activeIndex) return

      groupMessages.forEach((msg) => {
        const meta = getVersionMeta(msg)
        const shouldBeActive = meta.versionIndex === targetIndex
        if (Boolean(meta.isActiveVersion) !== shouldBeActive) {
          updateMessage({
            ...msg,
            metadata: {
              ...(msg.metadata as Record<string, unknown> | undefined),
              isActiveVersion: shouldBeActive,
            },
          })
        }
      })

      const refreshedMessages = useMessages.getState().getMessages(threadId)
      setChatMessages(
        convertThreadMessagesToUIMessages(
          selectVisibleMessages(refreshedMessages)
        )
      )
    },
    [threadId, updateMessage, setChatMessages]
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
    handleSwitchVersion,
    handleContextSizeIncrease,
  }
}
