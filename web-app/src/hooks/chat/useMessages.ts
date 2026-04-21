import { create } from 'zustand'
import { ThreadMessage } from '@ax-studio/core'
import { getServiceHub } from '@/hooks/useServiceHub'

const trackedMessageKey = (threadId: string, messageId: string) =>
  `${threadId}:${messageId}`

const persistedMessages = new Map<string, ThreadMessage>()
const latestMessageMutationId = new Map<string, number>()
const latestSuccessfulMutationId = new Map<string, number>()
const visibleMessageMutationId = new Map<string, number>()
const pendingMessageMutationIds = new Map<string, Set<number>>()

const trackPersistedMessage = (message: ThreadMessage) => {
  const key = trackedMessageKey(message.thread_id, message.id)
  persistedMessages.set(key, message)
  const successId = latestMessageMutationId.get(key) ?? 0
  latestSuccessfulMutationId.set(key, successId)
  if (!pendingMessageMutationIds.has(key)) {
    visibleMessageMutationId.set(key, successId)
  }
}

export const clearTrackedThreadMessages = (threadId: string) => {
  const prefix = `${threadId}:`
  for (const key of persistedMessages.keys()) {
    if (key.startsWith(prefix)) {
      persistedMessages.delete(key)
      latestMessageMutationId.delete(key)
      latestSuccessfulMutationId.delete(key)
      visibleMessageMutationId.delete(key)
      pendingMessageMutationIds.delete(key)
    }
  }
}

const removeTrackedMessage = (threadId: string, messageId: string) => {
  const key = trackedMessageKey(threadId, messageId)
  persistedMessages.delete(key)
  latestMessageMutationId.delete(key)
  latestSuccessfulMutationId.delete(key)
  visibleMessageMutationId.delete(key)
  pendingMessageMutationIds.delete(key)
}

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
    clearTrackedThreadMessages(threadId)
    messages.forEach(trackPersistedMessage)
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

    // Persist to storage asynchronously — rollback on failure
    getServiceHub().messages().createMessage(newMessage).then((createdMessage) => {
      console.info('[MessagePersist] Saved message', newMessage.id, 'to thread', newMessage.thread_id)
      if (createdMessage.id !== newMessage.id) {
        removeTrackedMessage(newMessage.thread_id, newMessage.id)
      }
      trackPersistedMessage(createdMessage)
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
      // Rollback: remove the optimistically added message
      set((state) => ({
        messages: {
          ...state.messages,
          [message.thread_id]: (state.messages[message.thread_id] || []).filter(
            (m) => m.id !== newMessage.id
          ),
        },
      }))
    })
  },
  updateMessage: (message) => {
    const updatedMessage = {
      ...message,
    }
    const messageKey = trackedMessageKey(message.thread_id, message.id)
    const mutationId = (latestMessageMutationId.get(messageKey) ?? 0) + 1
    latestMessageMutationId.set(messageKey, mutationId)
    const pendingMutations = pendingMessageMutationIds.get(messageKey) ?? new Set<number>()
    pendingMutations.add(mutationId)
    pendingMessageMutationIds.set(messageKey, pendingMutations)
    visibleMessageMutationId.set(messageKey, mutationId)

    // Roll back to the last backend-confirmed version rather than a prior optimistic edit.
    const previousMessage =
      persistedMessages.get(messageKey) ??
      get().messages[message.thread_id]?.find((m) => m.id === message.id)

    // Optimistically update state immediately for instant UI feedback
    set((state) => ({
      messages: {
        ...state.messages,
        [message.thread_id]: (state.messages[message.thread_id] || []).map((m) =>
          m.id === message.id ? updatedMessage : m
        ),
      },
    }))

    // Persist to storage asynchronously — targeted rollback on failure
    getServiceHub().messages().modifyMessage(updatedMessage).then((persistedMessage) => {
      const remainingPendingMutations = pendingMessageMutationIds.get(messageKey)
      remainingPendingMutations?.delete(mutationId)
      if (!remainingPendingMutations?.size) {
        pendingMessageMutationIds.delete(messageKey)
      }

      const latestSuccess = latestSuccessfulMutationId.get(messageKey) ?? 0
      if (mutationId >= latestSuccess) {
        persistedMessages.set(messageKey, persistedMessage)
        latestSuccessfulMutationId.set(messageKey, mutationId)
      }

      const higherPendingExists = Array.from(
        pendingMessageMutationIds.get(messageKey) ?? []
      ).some((pendingId) => pendingId > mutationId)
      const currentVisible = visibleMessageMutationId.get(messageKey) ?? 0
      if (higherPendingExists || currentVisible > mutationId) return

      visibleMessageMutationId.set(messageKey, mutationId)

      set((state) => ({
        messages: {
          ...state.messages,
          [message.thread_id]: (state.messages[message.thread_id] || []).map((m) =>
            m.id === message.id ? persistedMessage : m
          ),
        },
      }))
    }).catch((error) => {
      console.error('Failed to persist message update:', error)
      const remainingPendingMutations = pendingMessageMutationIds.get(messageKey)
      remainingPendingMutations?.delete(mutationId)
      if (!remainingPendingMutations?.size) {
        pendingMessageMutationIds.delete(messageKey)
      }

      if ((visibleMessageMutationId.get(messageKey) ?? 0) !== mutationId) return

      visibleMessageMutationId.set(
        messageKey,
        latestSuccessfulMutationId.get(messageKey) ?? 0
      )
      if (previousMessage) {
        set((state) => ({
          messages: {
            ...state.messages,
            [message.thread_id]: (state.messages[message.thread_id] || []).map((m) =>
              m.id === message.id ? previousMessage : m
            ),
          },
        }))
      }
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
    getServiceHub().messages().deleteMessage(threadId, messageId).then(() => {
      removeTrackedMessage(threadId, messageId)
    }).catch((error) => {
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
    persistedMessages.clear()
    latestMessageMutationId.clear()
    latestSuccessfulMutationId.clear()
    visibleMessageMutationId.clear()
    pendingMessageMutationIds.clear()
    set({ messages: {} })
  },
}))
