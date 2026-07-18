 
import { create } from 'zustand'
import type { Chat, UIMessage } from '@ai-sdk/react'
import type { ChatStatus } from 'ai'
import { CustomChatTransport } from '@/lib/custom-chat-transport'
import {
  createSessionData,
  createSession,
  applyStatusUpdate,
  destroySession,
} from '@/lib/chat/chat-session-controller'
// Re-export types and helpers so existing importers don't break
export type { SessionData, ChatSession } from '@/lib/chat/chat-session-types'
export { isSessionBusy } from '@/lib/chat/chat-session-controller'
import type { SessionData, ChatSession } from '@/lib/chat/chat-session-types'

interface ChatSessionState {
  sessions: Record<string, ChatSession>
  standaloneData: Record<string, SessionData>
  activeConversationId?: string
  setActiveConversationId: (conversationId?: string) => void
  ensureSession: (
    sessionId: string,
    transport: CustomChatTransport,
    createChat: (
      sessionId?: string,
      transport?: CustomChatTransport
    ) => Chat<UIMessage>,
    title?: string,
  ) => Chat<UIMessage>
  getSessionData: (sessionId: string) => SessionData | null
  ensureSessionData: (sessionId: string) => SessionData
  updateStatus: (sessionId: string, status: ChatStatus) => void
  setSessionTitle: (sessionId: string, title?: string) => void
  removeSession: (sessionId: string) => void
  clearSessions: () => void
}

const getOwnRecordValue = <T>(
  record: Record<string, T>,
  key: string
): T | undefined =>
  Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined

export const useChatSessions = create<ChatSessionState>((set, get) => ({
  sessions: {},
  standaloneData: {},
  activeConversationId: undefined,
  setActiveConversationId: (conversationId) =>
    set({ activeConversationId: conversationId }),

  ensureSession: (sessionId, transport, createChatFn, title) => {
    // Set active immediately
    if (get().activeConversationId !== sessionId) {
      set({ activeConversationId: sessionId })
    }

    const existing = getOwnRecordValue(get().sessions, sessionId)
    if (existing) {
      const transportChanged = existing.transport !== transport
      const titleChanged = existing.title !== title
      if (transportChanged || titleChanged) {
        // Only recreate the Chat instance when the transport changes.
        // A title-only change (e.g. thread rename on first message) must NOT
        // recreate Chat — that would discard any in-flight streaming request.
        const updatedChat = transportChanged && createChatFn
          ? createChatFn(sessionId, transport)
          : existing.chat
        set((state) => ({
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...existing,
              transport,
              title: title ?? existing.title,
              chat: updatedChat,
            },
          },
        }))
        return updatedChat
      }
      return existing.chat
    }

    const existingData = getOwnRecordValue(get().standaloneData, sessionId)
    const newSession = createSession(
      sessionId,
      transport,
      createChatFn,
      title,
      existingData,
      (id, status) => get().updateStatus(id, status)
    )

    // Move standalone data into the new session atomically
    set((state) => {
      const { [sessionId]: _, ...remainingStandalone } = state.standaloneData
      return {
        sessions: { ...state.sessions, [sessionId]: newSession },
        standaloneData: remainingStandalone,
      }
    })

    return newSession.chat
  },

  getSessionData: (sessionId) => {
    const existing = getOwnRecordValue(get().sessions, sessionId)
    if (existing) return existing.data

    return getOwnRecordValue(get().standaloneData, sessionId) ?? null
  },

  ensureSessionData: (sessionId) => {
    const existing = getOwnRecordValue(get().sessions, sessionId)
    if (existing) return existing.data

    const standalone = get().standaloneData
    const existingData = getOwnRecordValue(standalone, sessionId)
    if (!existingData) {
      const newData = createSessionData()
      set((state) => ({
        standaloneData: { ...state.standaloneData, [sessionId]: newData },
      }))
      return newData
    }
    return existingData
  },

  updateStatus: (sessionId, status) => {
    set((state) => {
      const existing = getOwnRecordValue(state.sessions, sessionId)
      if (!existing) return state

      const updated = applyStatusUpdate(existing, status)
      if (!updated) return state

      return {
        sessions: { ...state.sessions, [sessionId]: updated },
      }
    })
  },

  setSessionTitle: (sessionId, title) => {
    if (!title) return

    set((state) => {
      const existing = getOwnRecordValue(state.sessions, sessionId)
      if (!existing || existing.title === title) return state

      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...existing, title },
        },
      }
    })
  },

  removeSession: (sessionId) => {
    const existing = getOwnRecordValue(get().sessions, sessionId)
    if (!existing) {
      set((state) => {
        const { [sessionId]: _, ...rest } = state.standaloneData
        return { standaloneData: rest }
      })
      return
    }

    // Remove from store FIRST — prevents updateStatus from reacting during cleanup
    set((state) => {
      if (!getOwnRecordValue(state.sessions, sessionId)) return state
      const { [sessionId]: _s, ...restSessions } = state.sessions
      const { [sessionId]: _d, ...restStandalone } = state.standaloneData
      return { sessions: restSessions, standaloneData: restStandalone }
    })

    destroySession(existing)
  },

  clearSessions: () => {
    const sessions = get().sessions
    Object.values(sessions).forEach(destroySession)
    set({ sessions: {}, standaloneData: {}, activeConversationId: undefined })
  },
}))
