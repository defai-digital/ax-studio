/**
 * useChatSendHandler — encapsulates handleSendMessage for ChatInput.
 *
 * Handles: model guard, ingest guard, AI SDK submit path, and the
 * new-thread creation + sessionStorage + navigation path.
 */
import { useCallback } from 'react'
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

  const handleSendMessage = useCallback(
    async (prompt: string) => {
      if (!selectedModel) {
        setMessage('Please select a model to start chatting.')
        return
      }
      if (!prompt.trim()) return

      setMessage('')

      if (onSubmit) {
        // AI SDK path — caller owns thread management
        onSubmit(prompt)
        setPrompt('')
        return
      }

      // New-thread path — create thread and navigate
      const isTemporaryChat = window.location.search.includes(
        `${TEMPORARY_CHAT_QUERY_ID}=true`
      )

      const messagePayload = { text: prompt }

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

        const storedTeamId = sessionStorage.getItem(SESSION_STORAGE_KEY.NEW_THREAD_TEAM_ID)
        if (storedTeamId) {
          sessionStorage.removeItem(SESSION_STORAGE_KEY.NEW_THREAD_TEAM_ID)
          useThreads.getState().updateThread(newThread.id, {
            metadata: { ...(newThread.metadata ?? {}), agent_team_id: storedTeamId },
          })
        }

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
