/**
 * useThreadEffects — consolidates all side-effects for the ThreadDetail route component.
 *
 * Handles: RAG tool availability, team token loading, reasoning scroll,
 * current-thread lifecycle, initial message dispatch, session-storage
 * thread-prompt and team-id application.
 */
import { useEffect, useRef } from 'react'
import type { UIMessage } from '@ai-sdk/react'
import type { ThreadMessage } from '@ax-studio/core'
import { SESSION_STORAGE_PREFIX, SESSION_STORAGE_KEY } from '@/constants/chat'
import { defaultAssistant } from '@/hooks/chat/useAssistant'
import {
  safeStorageGetItem,
  safeStorageParseJSONAs,
  safeStorageRemoveItem,
} from '@/lib/storage/storage'

export type ThreadEffectsInput = {
  threadId: string
  thread: Thread | undefined
  chatMessages: UIMessage[]
  persistedMessages: ThreadMessage[]
  messagesLoaded: boolean
  status: string
  assistants: Assistant[]
  selectedModel: Model | undefined
  reasoningContainerRef: React.RefObject<HTMLDivElement | null>
  setCurrentThreadId: (id?: string) => void
  setCurrentAssistant: (assistant: Assistant) => void
  processAndSendMessage: (text: string) => Promise<void>
  updateThread: (id: string, updates: Partial<Thread>) => void
  setThreadPromptDraft: (draft: string) => void
}

export function useThreadEffects({
  threadId,
  thread,
  chatMessages,
  persistedMessages,
  messagesLoaded,
  status,
  assistants,
  selectedModel: _selectedModel,
  reasoningContainerRef,
  setCurrentThreadId,
  setCurrentAssistant,
  processAndSendMessage,
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
  const processAndSendMessageRef = useRef(processAndSendMessage)
  processAndSendMessageRef.current = processAndSendMessage
  const updateThreadRef = useRef(updateThread)
  updateThreadRef.current = updateThread

  useEffect(() => {
    // Do not act on a launch hand-off until persisted messages have hydrated.
    // WebKit can restore sessionStorage after a Tauri process restart; without
    // this gate, a stale marker wins the race against history loading.
    if (!messagesLoaded) return
    if (initialMessageSentForThreadRef.current === threadId) return

    const initialMessageKey = `${SESSION_STORAGE_PREFIX.INITIAL_MESSAGE}${threadId}`
    const storedInitialMessage = safeStorageParseJSONAs(
      sessionStorage,
      initialMessageKey,
      (value: unknown): value is { text: string } =>
        typeof value === 'object' &&
        value !== null &&
        'text' in value &&
        typeof (value as { text?: unknown }).text === 'string',
      'useThreadEffects'
    )
    const metadataInitialMessage =
      typeof threadRef.current?.metadata?.pendingInitialMessage === 'string'
        ? { text: threadRef.current.metadata.pendingInitialMessage }
        : undefined
    const parsedInitialMessage = storedInitialMessage ?? metadataInitialMessage
    if (!parsedInitialMessage) return

    const clearInitialMessage = () => {
      safeStorageRemoveItem(sessionStorage, initialMessageKey, 'useThreadEffects')
      const metadata = threadRef.current?.metadata
      if (!metadata || typeof metadata.pendingInitialMessage !== 'string') return
      const { pendingInitialMessage: _pendingInitialMessage, ...remainingMetadata } = metadata
      updateThreadRef.current(threadId, { metadata: remainingMetadata })
    }

    const dispatchTimer = window.setTimeout(() => {
      void (async () => {
        if (initialMessageSentForThreadRef.current === threadId) return
        initialMessageSentForThreadRef.current = threadId

        const message = parsedInitialMessage.text
        if (!message) {
          console.error('Invalid initial message payload in sessionStorage')
          initialMessageSentForThreadRef.current = null
          return
        }

        const normalizedMessage = message.trim()
        // Prefer the live AI SDK transcript: after a live-session hydrate the
        // store may still lag (or briefly hold []) while chatMessages already
        // shows the user turn that must not be re-sent.
        const existsInChat = chatMessages.some((chatMessage) => {
          if (chatMessage.role !== 'user') return false
          const text = chatMessage.parts
            .map((part) => (part.type === 'text' ? part.text : ''))
            .join('')
            .trim()
          return text === normalizedMessage
        })
        const existsInStore = persistedMessages.some((storedMessage) => {
          if (storedMessage.role !== 'user') return false
          const text = storedMessage.content
            .map((part) => part.text?.value ?? '')
            .join('')
            .trim()
          return text === normalizedMessage
        })
        const messageAlreadyExists = existsInChat || existsInStore

        // Consume the launch hand-off before beginning any asynchronous
        // preparation or generation. A Tauri reload can interrupt an active
        // local-model request; leaving this marker behind makes the next app
        // launch silently submit the same prompt again and can look like the
        // application has hung while a long response is regenerated.
        clearInitialMessage()
        if (messageAlreadyExists) return
        await processAndSendMessageRef.current(message)
      })().catch((error) => {
        console.error('Failed to process initial message:', error)
      })
    }, 0)

    return () => {
      window.clearTimeout(dispatchTimer)
    }
  }, [
    threadId,
    thread?.metadata?.pendingInitialMessage,
    messagesLoaded,
    chatMessages,
    persistedMessages,
  ])

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
