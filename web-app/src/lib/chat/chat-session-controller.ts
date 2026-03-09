/**
 * chat-session-controller — pure functions for chat session lifecycle management.
 * No React, no Zustand. Stateless: all functions take current state and return new state.
 *
 * The Zustand store delegates to these functions so the logic can be unit-tested
 * in isolation without a React runtime.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Chat, UIMessage } from '@ai-sdk/react'
import type { ChatStatus } from 'ai'
import type { CustomChatTransport } from '@/lib/custom-chat-transport'
import type { ChatSession, SessionData } from './chat-session-types'

export const STREAMING_STATUSES: ChatStatus[] = ['submitted', 'streaming']

// ─── Session data ────────────────────────────────────────────────────────────

export function createSessionData(): SessionData {
  return {
    tools: [],
    messages: [],
    idMap: new Map<string, string>(),
  }
}

// ─── Session lifecycle ───────────────────────────────────────────────────────

/**
 * Returns true if the session has active streaming or pending tool calls.
 */
export function isSessionBusy(session: ChatSession | undefined): boolean {
  return (session?.isStreaming ?? false) || (session?.data?.tools?.length ?? 0) > 0
}

/**
 * Creates a new ChatSession from a factory. Registers the status callback
 * so the store can react to status changes without polling.
 *
 * @param onStatusChange — called by the SDK status callback; must be stable.
 */
export function createSession(
  sessionId: string,
  transport: CustomChatTransport,
  createChat: () => Chat<UIMessage>,
  title: string | undefined,
  existingData: SessionData | undefined,
  onStatusChange: (sessionId: string, status: ChatStatus) => void
): ChatSession {
  const chat = createChat()
  const syncStatus = () => onStatusChange(sessionId, chat.status)
  const unsubscribeStatus = (chat as any)['~registerStatusCallback']
    ? (chat as any)['~registerStatusCallback'](syncStatus)
    : undefined

  return {
    chat,
    transport,
    status: chat.status,
    title,
    isStreaming: STREAMING_STATUSES.includes(chat.status),
    unsubscribers: unsubscribeStatus ? [unsubscribeStatus] : [],
    data: existingData ?? createSessionData(),
  }
}

/**
 * Returns an updated ChatSession with the new status, or null if no change
 * is needed (status and isStreaming are identical).
 */
export function applyStatusUpdate(
  session: ChatSession,
  status: ChatStatus
): ChatSession | null {
  const isStreaming = STREAMING_STATUSES.includes(status)
  if (session.status === status && session.isStreaming === isStreaming) {
    return null
  }
  return { ...session, status, isStreaming }
}

/**
 * Tears down a session: calls all unsubscribers then stops the chat.
 * Errors in individual steps are logged but do not abort the rest.
 */
export function destroySession(session: ChatSession): void {
  session.unsubscribers.forEach((unsubscribe) => {
    try {
      unsubscribe()
    } catch (error) {
      console.error('Failed to unsubscribe chat session listener', error)
    }
  })
  try {
    session.chat.stop()
  } catch (error) {
    console.error('Failed to stop chat session', error)
  }
}
