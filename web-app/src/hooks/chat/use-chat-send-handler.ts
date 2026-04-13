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
  SESSION_STORAGE_KEY,
} from '@/constants/chat'
import { defaultModel } from '@/lib/models'
import { toast } from 'sonner'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useModelProvider } from '@/hooks/models/useModelProvider'
import { useThreads } from '@/hooks/threads/useThreads'
import { useChatAttachments, NEW_THREAD_ATTACHMENT_KEY } from '@/hooks/chat/useChatAttachments'
import {
  safeStorageGetItem,
  safeStorageRemoveItem,
  safeStorageSetItem,
} from '@/lib/storage'

type Input = {
  onSubmit?: (text: string) => void
  projectId?: string
  assistants: Assistant[]
  selectedAssistant: Assistant | undefined
  setSelectedAssistant: (a: Assistant | undefined) => void
  setMessage: (msg: string) => void
  setPrompt: (value: string) => void
}

type Result = {
  handleSendMessage: (prompt: string) => Promise<void>
}

export function useChatSendHandler({
  onSubmit,
  projectId,
  assistants,
  selectedAssistant,
  setSelectedAssistant,
  setMessage,
  setPrompt,
}: Input): Result {
  const serviceHub = useServiceHub()
  const selectedModel = useModelProvider((s) => s.selectedModel)
  const selectedProvider = useModelProvider((s) => s.selectedProvider)
  const createThread = useThreads((s) => s.createThread)
  const router = useRouter()
  // Double-submit guard: a rapid double-click on the send button used to
  // create two threads (and navigate to one, leaving the other orphaned).
  // A ref-based mutex keeps this predictable without triggering re-renders.
  const sendingRef = useRef(false)

  const handleSendMessage = useCallback(
    async (prompt: string) => {
      if (sendingRef.current) return
      if (!selectedModel) {
        setMessage('Please select a model to start chatting.')
        return
      }
      if (!prompt.trim()) return
      sendingRef.current = true
      try {
        // Guard: don't send while attachments are processing
        const pendingKey = useThreads.getState().currentThreadId || NEW_THREAD_ATTACHMENT_KEY
        const pending = useChatAttachments.getState().getAttachments(pendingKey)
        if (pending.some((a) => a.processing)) {
          toast.info('Please wait for attachments to finish processing')
          return
        }

        if (onSubmit) {
          // AI SDK path — caller owns thread management
          onSubmit(prompt)
          setMessage('')
          setPrompt('')
          return
        }

        // New-thread path — create thread and navigate
        const isTemporaryChat = window.location.search.includes(
          `${TEMPORARY_CHAT_QUERY_ID}=true`
        )

        const messagePayload = { text: prompt }

        if (isTemporaryChat) {
          const storedTemporaryMessage = safeStorageSetItem(
            sessionStorage,
            SESSION_STORAGE_KEY.INITIAL_MESSAGE_TEMPORARY,
            JSON.stringify(messagePayload),
            'useChatSendHandler'
          )
          const storedTempNavigation = safeStorageSetItem(
            sessionStorage,
            'temp-chat-nav',
            'true',
            'useChatSendHandler'
          )
          if (!storedTemporaryMessage || !storedTempNavigation) {
            console.warn('sessionStorage write failed for temporary chat; continuing navigation')
          }
          // Transfer pending attachments to the temporary chat ID
          useChatAttachments.getState().transferAttachments(
            NEW_THREAD_ATTACHMENT_KEY,
            TEMPORARY_CHAT_ID
          )
          router.navigate({
            to: route.threadsDetail,
            params: { threadId: TEMPORARY_CHAT_ID },
          })
        } else {
          let projectMetadata:
            | {
                id: string
                name: string
                updated_at: number
                logo?: string
                projectPrompt?: string | null
              }
            | undefined
          let projectAssistantId: string | undefined

          if (projectId) {
            try {
              const project = await serviceHub.projects().getProjectById(projectId)
              if (project) {
                projectMetadata = {
                  id: project.id,
                  name: project.name,
                  updated_at: project.updated_at,
                  logo: project.logo,
                  projectPrompt: project.projectPrompt ?? null,
                }
                projectAssistantId = project.assistantId
              }
            } catch (e) {
              console.warn('Failed to fetch project metadata:', e)
            }
          }

          const assistant = projectAssistantId
            ? assistants.find((a) => a.id === projectAssistantId)
            : selectedAssistant

          const newThread = await createThread(
            {
              id: selectedModel?.id ?? defaultModel(selectedProvider),
              provider: selectedProvider,
            },
            prompt,
            assistant,
            projectMetadata
          )

          // Transfer pending attachments from the home-page key to the real thread
          useChatAttachments.getState().transferAttachments(
            NEW_THREAD_ATTACHMENT_KEY,
            newThread.id
          )

          const storedTeamId = safeStorageGetItem(
            sessionStorage,
            SESSION_STORAGE_KEY.NEW_THREAD_TEAM_ID,
            'useChatSendHandler'
          )
          if (storedTeamId) {
            safeStorageRemoveItem(
              sessionStorage,
              SESSION_STORAGE_KEY.NEW_THREAD_TEAM_ID,
              'useChatSendHandler'
            )
            useThreads.getState().updateThread(newThread.id, {
              metadata: { ...(newThread.metadata ?? {}), agent_team_id: storedTeamId },
            })
          }

          setSelectedAssistant(undefined)

          const storedInitialMessage = safeStorageSetItem(
            sessionStorage,
            `${SESSION_STORAGE_PREFIX.INITIAL_MESSAGE}${newThread.id}`,
            JSON.stringify(messagePayload),
            'useChatSendHandler'
          )
          if (!storedInitialMessage) {
            console.warn('sessionStorage write failed for initial message; continuing navigation')
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
        setMessage(prompt)
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
      assistants,
      createThread,
      onSubmit,
      projectId,
      router,
      selectedAssistant,
      selectedModel,
      selectedProvider,
      serviceHub,
      setMessage,
      setPrompt,
      setSelectedAssistant,
    ]
  )

  return { handleSendMessage }
}
