/**
 * useThreadEffects — consolidates all side-effects for the ThreadDetail route component.
 *
 * Handles: RAG tool availability, team token loading, reasoning scroll,
 * current-thread lifecycle, initial message dispatch, session-storage
 * thread-prompt and team-id application.
 */
import { useEffect, useRef } from 'react'
import type { UIMessage } from '@ai-sdk/react'
import { SESSION_STORAGE_PREFIX, SESSION_STORAGE_KEY } from '@/constants/chat'
import { defaultAssistant } from '@/hooks/chat/useAssistant'
import {
  safeStorageGetItem,
  safeStorageRemoveItem,
} from '@/lib/storage/storage'

export type ThreadEffectsInput = {
  threadId: string
  thread: Thread | undefined
  chatMessages: UIMessage[]
  status: string
  assistants: Assistant[]
  selectedModel: Model | undefined
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
  // Use refs for all callbacks so the effect only re-runs when threadId changes.
  // Callbacks are recreated on every render (unstable deps chain via Zustand
  // selectors), so putting them in the dep array would re-trigger the effect.
  const handleResearchCommandRef = useRef(handleResearchCommand)
  handleResearchCommandRef.current = handleResearchCommand
  const processAndSendMessageRef = useRef(processAndSendMessage)
  processAndSendMessageRef.current = processAndSendMessage

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
        if (handleResearchCommandRef.current(message.text)) {
          // Research started — do NOT cancel on cleanup. Research runs independently
          // of this effect's lifecycle and should only be cancelled by the user.
          return
        }
        if (cancelled) return
        await processAndSendMessageRef.current(message.text)
      } catch (error) {
        console.error('Failed to parse initial message:', error)
      }
    })()

    return () => {
      // Only cancel in-progress chat streaming, not research.
      // React StrictMode runs this cleanup on every mount cycle, so cancelling
      // research here would abort it immediately on the first message.
      cancelled = true
    }
  }, [threadId])

  // ─── Apply thread prompt from sessionStorage ──────────────────────────────
  const sessionCarryAppliedForThreadRef = useRef<string | null>(null)
  useEffect(() => {
    if (sessionCarryAppliedForThreadRef.current === threadId) return
    const storedPrompt = safeStorageGetItem(
      sessionStorage,
      SESSION_STORAGE_KEY.NEW_THREAD_PROMPT,
      'useThreadEffects'
    )
    if (!storedPrompt) return
    sessionCarryAppliedForThreadRef.current = threadId
    safeStorageRemoveItem(sessionStorage, SESSION_STORAGE_KEY.NEW_THREAD_PROMPT, 'useThreadEffects')
    updateThread(threadId, {
      metadata: { ...(thread?.metadata ?? {}), threadPrompt: storedPrompt },
    })
    setThreadPromptDraft(storedPrompt)
  }, [threadId, thread?.metadata, updateThread, setThreadPromptDraft])
}
