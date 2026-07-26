/**
 * useChatSendHandler — encapsulates handleSendMessage for ChatInput.
 *
 * Handles: model guard, ingest guard, AI SDK submit path, and the
 * new-thread creation + sessionStorage + navigation path.
 */
import { useCallback, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import {
  TEMPORARY_CHAT_ID,
  TEMPORARY_CHAT_QUERY_ID,
  SESSION_STORAGE_PREFIX,
} from '@/constants/chat'
import { defaultModel } from '@/lib/models'
import { toast } from 'sonner'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { useThreads } from '@/hooks/threads/useThreads'
import { useTemporaryChat } from '@/hooks/chat/useTemporaryChat'
import {
  useChatAttachments,
  NEW_THREAD_ATTACHMENT_KEY,
} from '@/hooks/chat/useChatAttachments'
import { safeStorageSetItem } from '@/lib/storage/storage'
import { hasSendableAttachment } from '@/lib/attachments/sendable'

const ATTACHMENT_ONLY_PROMPT = 'Please use the attached file.'

type Input = {
  onSubmit?: (text: string) => void
  projectId?: string
  selectedModel?: { id: string }
  attachmentsKey?: string
  setMessage: (msg: string) => void
  setPrompt: (value: string) => void
}

type Result = {
  handleSendMessage: (prompt: string) => Promise<void>
}

export function useChatSendHandler({
  onSubmit,
  selectedModel: resolvedSelectedModel,
  attachmentsKey,
  setMessage,
  setPrompt,
}: Input): Result {
  const selectedModelFromStore = useModelProvider((s) => s.selectedModel)
  const selectedProvider = useModelProvider((s) => s.selectedProvider)
  const createThread = useThreads((s) => s.createThread)
  const temporaryChatEnabled = useTemporaryChat((s) => s.temporaryChatEnabled)
  const router = useRouter()
  // Double-submit guard: a rapid double-click on the send button used to
  // create two threads (and navigate to one, leaving the other orphaned).
  // A ref-based mutex keeps this predictable without triggering re-renders.
  const sendingRef = useRef(false)

  const handleSendMessage = useCallback(
    async (prompt: string) => {
      if (sendingRef.current) return
      const selectedModel = resolvedSelectedModel ?? selectedModelFromStore
      const selectedModelId =
        selectedModel?.id ?? defaultModel(selectedProvider)
      if (!selectedModelId) {
        setMessage('Please select a model to start chatting.')
        return
      }
      const pendingKey =
        attachmentsKey ??
        useThreads.getState().currentThreadId ??
        NEW_THREAD_ATTACHMENT_KEY
      const pending = useChatAttachments.getState().getAttachments(pendingKey)
      const hasReadyAttachment = hasSendableAttachment(pending)
      if (!prompt.trim() && !hasReadyAttachment) return

      const messageText = prompt.trim() ? prompt : ATTACHMENT_ONLY_PROMPT
      sendingRef.current = true
      try {
        // Guard: don't send while attachments are processing
        if (pending.some((a) => a.processing)) {
          toast.info('Please wait for attachments to finish processing')
          return
        }

        if (onSubmit) {
          // AI SDK path — caller owns thread management
          onSubmit(messageText)
          setMessage('')
          setPrompt('')
          return
        }

        // New-thread path — create thread and navigate. Temporary mode is
        // triggered by the composer toggle (useTemporaryChat) or the legacy
        // `?temporary-chat=true` query param.
        const isTemporaryChat =
          temporaryChatEnabled ||
          window.location.search.includes(`${TEMPORARY_CHAT_QUERY_ID}=true`)

        const messagePayload = { text: messageText }

        if (isTemporaryChat) {
          // The thread route redirects home for unknown IDs, so the in-memory
          // temporary thread must exist before navigating. Reuse the existing
          // one if present — re-entering temporary mode continues the same
          // unsaved conversation instead of wiping it.
          if (!useThreads.getState().threads[TEMPORARY_CHAT_ID]) {
            await createThread(
              {
                id: selectedModelId,
                provider: selectedProvider,
              },
              undefined,
              undefined,
              undefined,
              /* isTemporary */ true
            )
          }
          // useThreadEffects consumes the per-thread initial-message key, so
          // the first message is dispatched once the temporary thread mounts.
          const storedTemporaryMessage = safeStorageSetItem(
            sessionStorage,
            `${SESSION_STORAGE_PREFIX.INITIAL_MESSAGE}${TEMPORARY_CHAT_ID}`,
            JSON.stringify(messagePayload),
            'useChatSendHandler'
          )
          if (!storedTemporaryMessage) {
            console.warn(
              'sessionStorage write failed for temporary chat; continuing navigation'
            )
          }
          // Transfer pending attachments to the temporary chat ID
          useChatAttachments
            .getState()
            .transferAttachments(NEW_THREAD_ATTACHMENT_KEY, TEMPORARY_CHAT_ID)
          router.navigate({
            to: route.threadsDetail,
            params: { threadId: TEMPORARY_CHAT_ID },
          })
        } else {
          const newThread = await createThread(
            {
              id: selectedModelId,
              provider: selectedProvider,
            },
            messageText
          )

          useThreads.getState().updateThread(newThread.id, {
            metadata: {
              ...(newThread.metadata ?? {}),
              pendingInitialMessage: messageText,
            },
          })

          // Transfer pending attachments from the home-page key to the real thread
          useChatAttachments
            .getState()
            .transferAttachments(NEW_THREAD_ATTACHMENT_KEY, newThread.id)

          const storedInitialMessage = safeStorageSetItem(
            sessionStorage,
            `${SESSION_STORAGE_PREFIX.INITIAL_MESSAGE}${newThread.id}`,
            JSON.stringify(messagePayload),
            'useChatSendHandler'
          )
          if (!storedInitialMessage) {
            console.warn(
              'sessionStorage write failed for initial message; continuing navigation'
            )
          }

          router.navigate({
            to: route.threadsDetail,
            params: { threadId: newThread.id },
          })
        }

        setMessage('')
        setPrompt('')
      } catch (error) {
        console.error('Failed to send message:', error)
        setMessage(messageText)
        toast.error('Failed to send message', {
          description:
            error instanceof Error
              ? error.message
              : 'The message could not be queued for delivery.',
        })
      } finally {
        sendingRef.current = false
      }
    },
    [
      attachmentsKey,
      createThread,
      onSubmit,
      router,
      selectedModelFromStore,
      resolvedSelectedModel,
      selectedProvider,
      setMessage,
      setPrompt,
      temporaryChatEnabled,
    ]
  )

  return { handleSendMessage }
}
