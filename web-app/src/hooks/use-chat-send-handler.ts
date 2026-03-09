/**
 * useChatSendHandler — encapsulates handleSendMessage for ChatInput.
 *
 * Handles: model guard, ingest guard, AI SDK submit path, and the
 * new-thread creation + sessionStorage + navigation path.
 */
import { useCallback } from 'react'
import { toast } from 'sonner'
import { useRouter } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import {
  TEMPORARY_CHAT_ID,
  TEMPORARY_CHAT_QUERY_ID,
  SESSION_STORAGE_PREFIX,
  SESSION_STORAGE_KEY,
} from '@/constants/chat'
import { defaultModel } from '@/lib/models'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useThreads } from '@/hooks/useThreads'
import { useChatAttachments } from '@/hooks/useChatAttachments'
import type { Attachment } from '@/types/attachment'

type Input = {
  attachmentsKey: string
  attachments: Attachment[]
  ingestingAny: boolean
  onSubmit?: (
    text: string,
    files?: Array<{ type: string; mediaType: string; url: string }>
  ) => void
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
  attachmentsKey,
  attachments,
  ingestingAny,
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
  const clearAttachmentsForThread = useChatAttachments((s) => s.clearAttachments)
  const router = useRouter()

  const handleSendMessage = useCallback(
    async (prompt: string) => {
      if (!selectedModel) {
        setMessage('Please select a model to start chatting.')
        return
      }
      if (!prompt.trim()) return
      if (ingestingAny) {
        toast.info('Please wait for attachments to finish processing')
        return
      }

      setMessage('')

      // Build file parts for image attachments (shared between both paths)
      const files = attachments
        .filter((att) => att.type === 'image' && att.dataUrl)
        .map((att) => ({
          type: 'file',
          mediaType: att.mimeType ?? 'image/jpeg',
          url: att.dataUrl!,
        }))

      if (onSubmit) {
        // AI SDK path — caller owns thread management
        onSubmit(prompt, files.length > 0 ? files : undefined)
        setPrompt('')
        clearAttachmentsForThread(attachmentsKey)
        return
      }

      // New-thread path — create thread and navigate
      const isTemporaryChat = window.location.search.includes(
        `${TEMPORARY_CHAT_QUERY_ID}=true`
      )

      const messagePayload = { text: prompt, files: files.length > 0 ? files : [] }

      if (isTemporaryChat) {
        sessionStorage.setItem(
          SESSION_STORAGE_KEY.INITIAL_MESSAGE_TEMPORARY,
          JSON.stringify(messagePayload)
        )
        sessionStorage.setItem('temp-chat-nav', 'true')
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

        setSelectedAssistant(undefined)

        sessionStorage.setItem(
          `${SESSION_STORAGE_PREFIX.INITIAL_MESSAGE}${newThread.id}`,
          JSON.stringify(messagePayload)
        )

        router.navigate({
          to: route.threadsDetail,
          params: { threadId: newThread.id },
        })
      }

      setPrompt('')
      clearAttachmentsForThread(attachmentsKey)
    },
    [
      attachments,
      attachmentsKey,
      assistants,
      clearAttachmentsForThread,
      createThread,
      ingestingAny,
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
