/**
 * useThreadEffects — consolidates all side-effects for the ThreadDetail route component.
 *
 * Handles: RAG tool availability, team token loading, reasoning scroll,
 * current-thread lifecycle, initial message dispatch, session-storage
 * thread-prompt and team-id application.
 */
import { useEffect, useRef, useState } from 'react'
import type { UIMessage } from '@ai-sdk/react'
import { SESSION_STORAGE_PREFIX, SESSION_STORAGE_KEY } from '@/constants/chat'
import { defaultAssistant } from '@/hooks/chat/useAssistant'
import {
  safeStorageGetItem,
  safeStorageRemoveItem,
} from '@/lib/storage'

export type ThreadEffectsInput = {
  threadId: string
  thread: Thread | undefined
  chatMessages: UIMessage[]
  status: string
  assistants: Assistant[]
  selectedModel: Model | undefined
  activeTeamId: string | undefined
  setTeamTokensUsed: (tokens: number) => void
  reasoningContainerRef: React.RefObject<HTMLDivElement | null>
  setCurrentThreadId: (id?: string) => void
  setCurrentAssistant: (assistant: Assistant) => void
  processAndSendMessage: (text: string) => Promise<void>
  handleResearchCommand: (text: string) => boolean
  cancelResearch: () => void
  updateThread: (id: string, updates: Partial<Thread>) => void
  setThreadPromptDraft: (draft: string) => void
}

export function useThreadEffects({
  threadId,
  thread,
  chatMessages,
  status,
  assistants,
  selectedModel: _selectedModel,
  activeTeamId,
  setTeamTokensUsed,
  reasoningContainerRef,
  setCurrentThreadId,
  setCurrentAssistant,
  processAndSendMessage,
  handleResearchCommand,
  cancelResearch,
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

  // ─── Team token usage ─────────────────────────────────────────────────────
  // Token totals only change when a run completes, so we refetch on:
  //   1. thread / team change
  //   2. a `streaming → ready` transition (run just finished)
  //
  // We detect the transition via a ref mutated INSIDE `useEffect` rather
  // than during render — mutating a ref during render makes React Strict
  // Mode (which runs function bodies twice) miss the transition on the
  // second pass, breaking the refetch.
  const prevStatusRef = useRef(status)
  const [teamTokensRefreshKey, setTeamTokensRefreshKey] = useState(0)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    if (prev === 'streaming' && status === 'ready') {
      setTeamTokensRefreshKey((k) => k + 1)
    }
  }, [status])

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
  }, [activeTeamId, threadId, teamTokensRefreshKey, setTeamTokensUsed])

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
    const threadAssistantId = threadRef.current?.assistants?.[0]?.id
    const assistant = threadAssistantId
      ? assistants.find((a) => a.id === threadAssistantId)
      : undefined
    setCurrentAssistant(assistant ?? defaultAssistant)
  }, [threadId, assistants, thread?.assistants, setCurrentThreadId, setCurrentAssistant])

  // Ref stabilizes setCurrentThreadId for the unmount cleanup.
  const setCurrentThreadIdRef = useRef(setCurrentThreadId)
  setCurrentThreadIdRef.current = setCurrentThreadId

  useEffect(() => {
    return () => {
      setCurrentThreadIdRef.current(undefined)
    }
  }, [])

  // ─── Initial message from sessionStorage ─────────────────────────────────
  // Track which thread's initial message has already been consumed so the
  // dispatch re-arms for every new thread. The previous boolean ref was
  // flipped to `true` for the first thread and never reset — every
  // subsequent thread in the same session silently dropped its initial
  // message.
  const initialMessageSentForThreadRef = useRef<string | null>(null)
  useEffect(() => {
    if (initialMessageSentForThreadRef.current === threadId) return

    const initialMessageKey = `${SESSION_STORAGE_PREFIX.INITIAL_MESSAGE}${threadId}`
    const storedMessage = safeStorageGetItem(
      sessionStorage,
      initialMessageKey,
      'useThreadEffects'
    )
    if (!storedMessage) return

    let cancelled = false
    let startedResearch = false

    safeStorageRemoveItem(sessionStorage, initialMessageKey, 'useThreadEffects')
    initialMessageSentForThreadRef.current = threadId

    ;(async () => {
      try {
        const parsed = JSON.parse(storedMessage)
        const message = parsed && typeof parsed === 'object' && typeof parsed.text === 'string'
          ? (parsed as { text: string })
          : null
        if (!message) {
          console.error('Invalid initial message payload in sessionStorage')
          return
        }
        if (cancelled) return
        if (handleResearchCommand(message.text)) {
          startedResearch = true
          if (cancelled) cancelResearch()
          return
        }
        if (cancelled) return
        await processAndSendMessage(message.text)
      } catch (error) {
        console.error('Failed to parse initial message:', error)
      }
    })()

    return () => {
      cancelled = true
      if (startedResearch) {
        cancelResearch()
      }
    }
  }, [threadId, processAndSendMessage, handleResearchCommand, cancelResearch])

  // ─── Apply thread prompt + agent team from sessionStorage ────────────────
  // Merge both sessionStorage carries in a SINGLE updateThread call. The
  // previous split-into-two-effects implementation raced: each effect
  // spread `thread?.metadata` from the same render snapshot, so whichever
  // ran second overwrote the other's metadata patch.
  //
  // Track the thread id rather than a boolean so the carry re-arms for
  // every new thread (the removeItem below makes it a no-op on repeat
  // effects within the same thread anyway, but keying by id is the
  // honest signal).
  const sessionCarryAppliedForThreadRef = useRef<string | null>(null)
  useEffect(() => {
    if (sessionCarryAppliedForThreadRef.current === threadId) return
    const storedPrompt = safeStorageGetItem(
      sessionStorage,
      SESSION_STORAGE_KEY.NEW_THREAD_PROMPT,
      'useThreadEffects'
    )
    const storedTeamId = safeStorageGetItem(
      sessionStorage,
      SESSION_STORAGE_KEY.NEW_THREAD_TEAM_ID,
      'useThreadEffects'
    )
    if (!storedPrompt && !storedTeamId) return
    sessionCarryAppliedForThreadRef.current = threadId

    if (storedPrompt) {
      safeStorageRemoveItem(
        sessionStorage,
        SESSION_STORAGE_KEY.NEW_THREAD_PROMPT,
        'useThreadEffects'
      )
    }
    if (storedTeamId) {
      safeStorageRemoveItem(
        sessionStorage,
        SESSION_STORAGE_KEY.NEW_THREAD_TEAM_ID,
        'useThreadEffects'
      )
    }

    updateThread(threadId, {
      metadata: {
        ...(thread?.metadata ?? {}),
        ...(storedPrompt ? { threadPrompt: storedPrompt } : {}),
        ...(storedTeamId ? { agent_team_id: storedTeamId } : {}),
      },
    })

    if (storedPrompt) setThreadPromptDraft(storedPrompt)
  }, [threadId, thread?.metadata, updateThread, setThreadPromptDraft])
}
