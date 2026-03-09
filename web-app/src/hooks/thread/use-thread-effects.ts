/**
 * useThreadEffects — consolidates all side-effects for the ThreadDetail route component.
 *
 * Handles: RAG tool availability, team token loading, reasoning scroll,
 * current-thread lifecycle, initial message dispatch, session-storage
 * thread-prompt and team-id application.
 */
import { useEffect, useRef } from 'react'
import type { UIMessage } from '@ai-sdk/react'
import { ExtensionTypeEnum, VectorDBExtension } from '@ax-studio/core'
import { ExtensionManager } from '@/lib/extension'
import { useAttachments } from '@/hooks/useAttachments'
import { SESSION_STORAGE_PREFIX, SESSION_STORAGE_KEY } from '@/constants/chat'

export type ThreadEffectsInput = {
  threadId: string
  thread: Thread | undefined
  chatMessages: UIMessage[]
  status: string
  assistants: Assistant[]
  selectedModel: Model | undefined
  updateRagToolsAvailability: (hasDocuments: boolean, modelSupportsTools: boolean, ragAvailable: boolean) => void
  disabledTools: unknown
  activeTeamId: string | undefined
  setTeamTokensUsed: (tokens: number) => void
  reasoningContainerRef: React.RefObject<HTMLDivElement>
  setCurrentThreadId: (id?: string) => void
  setCurrentAssistant: (assistant: Assistant) => void
  processAndSendMessage: (text: string, files?: Array<{ type: string; mediaType: string; url: string }>) => Promise<void>
  handleResearchCommand: (text: string) => boolean
  updateThread: (id: string, updates: Partial<Thread>) => void
  setThreadPromptDraft: (draft: string) => void
}

export function useThreadEffects({
  threadId,
  thread,
  chatMessages,
  status,
  assistants,
  selectedModel,
  updateRagToolsAvailability,
  disabledTools,
  activeTeamId,
  setTeamTokensUsed,
  reasoningContainerRef,
  setCurrentThreadId,
  setCurrentAssistant,
  processAndSendMessage,
  handleResearchCommand,
  updateThread,
  setThreadPromptDraft,
}: ThreadEffectsInput): void {
  // ─── Sync thread prompt draft whenever the thread's stored prompt changes ────
  useEffect(() => {
    setThreadPromptDraft(
      typeof thread?.metadata?.threadPrompt === 'string'
        ? thread.metadata.threadPrompt
        : ''
    )
  }, [thread?.metadata?.threadPrompt, setThreadPromptDraft])

  // ─── RAG tools availability ───────────────────────────────────────────────
  useEffect(() => {
    const checkDocumentsAvailability = async () => {
      const hasThreadDocuments = Boolean(thread?.metadata?.hasDocuments)
      let hasProjectDocuments = false

      const projectId = thread?.metadata?.project?.id
      if (projectId) {
        try {
          const ext = ExtensionManager.getInstance().get<VectorDBExtension>(
            ExtensionTypeEnum.VectorDB
          )
          if (ext?.listAttachmentsForProject) {
            const projectFiles = await ext.listAttachmentsForProject(projectId)
            hasProjectDocuments = projectFiles.length > 0
          }
        } catch (error) {
          console.warn('Failed to check project files:', error)
        }
      }

      const hasDocuments = hasThreadDocuments || hasProjectDocuments
      const ragFeatureAvailable = Boolean(useAttachments.getState().enabled)
      const modelSupportsTools =
        selectedModel?.capabilities?.includes('tools') ?? false

      updateRagToolsAvailability(hasDocuments, modelSupportsTools, ragFeatureAvailable)
    }

    checkDocumentsAvailability()
  }, [
    thread?.metadata?.hasDocuments,
    thread?.metadata?.project?.id,
    selectedModel?.capabilities,
    updateRagToolsAvailability,
    disabledTools,
  ])

  // ─── Team token usage ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeTeamId || !threadId) {
      setTeamTokensUsed(0)
      return
    }
    let cancelled = false
    const loadUsage = async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        const logs = await invoke<Array<{ total_tokens: number }>>(
          'list_agent_run_logs',
          { threadId }
        )
        if (!cancelled) {
          const total = logs.reduce((sum, l) => sum + l.total_tokens, 0)
          setTeamTokensUsed(total)
        }
      } catch {
        // Silently ignore — web mode or no logs yet
      }
    }
    loadUsage()
    return () => {
      cancelled = true
    }
  }, [activeTeamId, threadId, status, setTeamTokensUsed])

  // ─── Reasoning container auto-scroll ─────────────────────────────────────
  useEffect(() => {
    if (status !== 'streaming' || !reasoningContainerRef.current) return
    const el = reasoningContainerRef.current
    const raf = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
    return () => cancelAnimationFrame(raf)
  }, [status, chatMessages, reasoningContainerRef])

  // ─── Current thread lifecycle ─────────────────────────────────────────────
  // Ref captures current thread so we don't re-run on every message update.
  const threadRef = useRef(thread)
  threadRef.current = thread

  useEffect(() => {
    setCurrentThreadId(threadId)
    const assistant = assistants.find(
      (a) => a.id === threadRef.current?.assistants?.[0]?.id
    )
    if (assistant) setCurrentAssistant(assistant)
  }, [threadId, assistants, setCurrentThreadId, setCurrentAssistant])

  // Ref stabilizes setCurrentThreadId for the unmount cleanup.
  const setCurrentThreadIdRef = useRef(setCurrentThreadId)
  setCurrentThreadIdRef.current = setCurrentThreadId

  useEffect(() => {
    return () => {
      setCurrentThreadIdRef.current(undefined)
    }
  }, [])

  // ─── Initial message from sessionStorage ─────────────────────────────────
  const initialMessageSentRef = useRef(false)
  useEffect(() => {
    if (initialMessageSentRef.current) return

    const initialMessageKey = `${SESSION_STORAGE_PREFIX.INITIAL_MESSAGE}${threadId}`
    const storedMessage = sessionStorage.getItem(initialMessageKey)

    if (storedMessage) {
      sessionStorage.removeItem(initialMessageKey)
      initialMessageSentRef.current = true
      ;(async () => {
        try {
          const message = JSON.parse(storedMessage) as {
            text: string
            files?: Array<{ type: string; mediaType: string; url: string }>
          }
          if (handleResearchCommand(message.text)) return
          await processAndSendMessage(message.text, message.files)
        } catch (error) {
          console.error('Failed to parse initial message:', error)
        }
      })()
    }
  }, [threadId, processAndSendMessage, handleResearchCommand])

  // ─── Apply thread prompt from sessionStorage ──────────────────────────────
  const threadPromptAppliedRef = useRef(false)
  useEffect(() => {
    if (threadPromptAppliedRef.current) return
    const storedPrompt = sessionStorage.getItem(SESSION_STORAGE_KEY.NEW_THREAD_PROMPT)
    if (storedPrompt) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY.NEW_THREAD_PROMPT)
      threadPromptAppliedRef.current = true
      updateThread(threadId, {
        metadata: {
          ...thread?.metadata,
          threadPrompt: storedPrompt,
        },
      })
      setThreadPromptDraft(storedPrompt)
    }
  }, [threadId, thread?.metadata, updateThread, setThreadPromptDraft])

  // ─── Apply agent team from sessionStorage ────────────────────────────────
  const teamAppliedRef = useRef(false)
  useEffect(() => {
    if (teamAppliedRef.current) return
    const storedTeamId = sessionStorage.getItem(SESSION_STORAGE_KEY.NEW_THREAD_TEAM_ID)
    if (storedTeamId) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY.NEW_THREAD_TEAM_ID)
      teamAppliedRef.current = true
      updateThread(threadId, {
        metadata: {
          ...(thread?.metadata ?? {}),
          agent_team_id: storedTeamId,
        },
      })
    }
  }, [threadId, thread?.metadata, updateThread])
}
