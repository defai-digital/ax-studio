import { create } from 'zustand'
import { ThreadMessage } from '@ax-studio/core'
import { getServiceHub } from '@/hooks/useServiceHub'

type MessageState = {
  messages: Record<string, ThreadMessage[]>
  getMessages: (threadId: string) => ThreadMessage[]
  setMessages: (threadId: string, messages: ThreadMessage[]) => void
  addMessage: (message: ThreadMessage) => void
  updateMessage: (message: ThreadMessage) => void
  deleteMessage: (threadId: string, messageId: string) => void
  clearAllMessages: () => void
}

export const useMessages = create<MessageState>()((set, get) => ({
  messages: {},
  getMessages: (threadId) => {
    return get().messages[threadId] || []
  },
  setMessages: (threadId, messages) => {
    set((state) => ({
      messages: {
        ...state.messages,
        [threadId]: messages,
      },
    }))
  },
  addMessage: (message) => {
    const newMessage = {
      ...message,
      created_at: message.created_at || Date.now(),
    }

    // Optimistically update state immediately for instant UI feedback
    set((state) => ({
      messages: {
        ...state.messages,
        [message.thread_id]: [
          ...(state.messages[message.thread_id] || []),
          newMessage,
        ],
      },
    }))

    // Persist to storage asynchronously
    getServiceHub().messages().createMessage(newMessage).then((createdMessage) => {
      set((state) => ({
        messages: {
          ...state.messages,
          [message.thread_id]:
            state.messages[message.thread_id]?.map((existing) =>
              existing.id === newMessage.id ? createdMessage : existing
            ) ?? [createdMessage],
        },
      }))
    }).catch((error) => {
      console.error('Failed to persist message:', error)
    })
  },
  updateMessage: (message) => {
    const updatedMessage = {
      ...message,
    }

    // Optimistically update state immediately for instant UI feedback
    set((state) => ({
      messages: {
        ...state.messages,
        [message.thread_id]: (state.messages[message.thread_id] || []).map((m) =>
          m.id === message.id ? updatedMessage : m
        ),
      },
    }))

    // Persist to storage asynchronously using modifyMessage instead of createMessage
    // to prevent duplicates when updating existing messages
    getServiceHub().messages().modifyMessage(updatedMessage).catch((error) => {
      console.error('Failed to persist message update:', error)
    })
  },
  deleteMessage: (threadId, messageId) => {
    const previousMessage = get().messages[threadId]?.find(
      (m) => m.id === messageId
    )
    // Optimistic update
    set((state) => ({
      messages: {
        ...state.messages,
        [threadId]:
          state.messages[threadId]?.filter(
            (message) => message.id !== messageId
          ) || [],
      },
    }))
    getServiceHub().messages().deleteMessage(threadId, messageId).catch((error) => {
      console.error('Failed to delete message, rolling back:', error)
      // Re-insert only the single deleted message using the CURRENT state.
      // Don't replay a full pre-delete snapshot — that would overwrite any
      // messages (assistant replies, follow-ups) that arrived during the
      // failed API-call window.
      if (!previousMessage) return
      set((state) => {
        const currentList = state.messages[threadId] ?? []
        if (currentList.some((m) => m.id === messageId)) return state
        const restored = [...currentList, previousMessage].sort(
          (a, b) => (a.created_at || 0) - (b.created_at || 0)
        )
        return {
          messages: { ...state.messages, [threadId]: restored },
        }
      })
    })
  },
  clearAllMessages: () => {
    set({ messages: {} })
  },
}))
