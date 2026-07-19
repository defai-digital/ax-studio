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

const getOwnMessages = (
  messages: Record<string, ThreadMessage[]>,
  threadId: string
): ThreadMessage[] | undefined => {
  if (!Object.prototype.hasOwnProperty.call(messages, threadId)) {
    return undefined
  }

  const threadMessages = messages[threadId]
  return Array.isArray(threadMessages) ? threadMessages : undefined
}

const cleanupTrackedMessageIfIdle = (key: string) => {
  if (pendingMessageMutationIds.get(key)?.size) return
  persistedMessages.delete(key)
  latestMessageMutationId.delete(key)
  latestSuccessfulMutationId.delete(key)
  visibleMessageMutationId.delete(key)
  pendingMessageMutationIds.delete(key)
}

export const clearTrackedThreadMessages = (threadId: string) => {
  const prefix = `${threadId}:`
  const trackedKeys = new Set([
    ...persistedMessages.keys(),
    ...latestMessageMutationId.keys(),
    ...latestSuccessfulMutationId.keys(),
    ...visibleMessageMutationId.keys(),
    ...pendingMessageMutationIds.keys(),
  ])
  for (const key of trackedKeys) {
    if (key.startsWith(prefix)) {
      persistedMessages.delete(key)
      latestMessageMutationId.delete(key)
      latestSuccessfulMutationId.delete(key)
      visibleMessageMutationId.delete(key)
      pendingMessageMutationIds.delete(key)
    }
  }
}

/**
 * Remove stale tracking entries for messages that no longer exist in the
 * store. Guards against unbounded Map growth when in-flight persistence
 * promises never settle (e.g. IPC channel dropped, backend crash) and their
 * .then()/.catch() cleanup callbacks never fire.
 */
const pruneStaleTrackedMessages = (
  threadId: string,
  validMessages: ThreadMessage[]
) => {
  const prefix = `${threadId}:`
  const validIds = new Set(validMessages.map((m) => m.id))
  const trackedKeys = new Set([
    ...persistedMessages.keys(),
    ...latestMessageMutationId.keys(),
    ...latestSuccessfulMutationId.keys(),
    ...visibleMessageMutationId.keys(),
    ...pendingMessageMutationIds.keys(),
  ])
  for (const key of trackedKeys) {
    if (!key.startsWith(prefix)) continue
    const messageId = key.slice(prefix.length)
    if (!validIds.has(messageId)) {
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
  updateMessages: (messages: ThreadMessage[]) => void
  deleteMessage: (threadId: string, messageId: string) => void
  removeThreadMessages: (threadId: string) => void
  clearAllMessages: () => void
}

export const useMessages = create<MessageState>()((set, get) => ({
  messages: {},
  getMessages: (threadId) => {
    return getOwnMessages(get().messages, threadId) ?? []
  },
  setMessages: (threadId, messages) => {
    clearTrackedThreadMessages(threadId)
    pruneStaleTrackedMessages(threadId, messages)
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
          ...(getOwnMessages(state.messages, message.thread_id) ?? []),
          newMessage,
        ],
      },
    }))

    // Persist to storage asynchronously — rollback on failure
    getServiceHub()
      .messages()
      .createMessage(newMessage)
      .then((createdMessage) => {
        if (createdMessage.id !== newMessage.id) {
          removeTrackedMessage(newMessage.thread_id, newMessage.id)
        }
        set((state) => {
          const existingMessages = getOwnMessages(
            state.messages,
            message.thread_id
          )
          // If the thread was cleared during the async gap, don't resurrect it
          // with a single message — that would lose all context.
          if (!existingMessages) return state
          return {
            messages: {
              ...state.messages,
              [message.thread_id]: existingMessages.map((existing) =>
                existing.id === newMessage.id ? createdMessage : existing
              ),
            },
          }
        })
      })
      .catch((error) => {
        console.error('Failed to persist message:', error)
        // Rollback: remove the optimistically added message
        set((state) => ({
          messages: {
            ...state.messages,
            [message.thread_id]: (
              getOwnMessages(state.messages, message.thread_id) ?? []
            ).filter((m) => m.id !== newMessage.id),
          },
        }))
      })
  },
  updateMessage: (message) => {
    const updatedMessage = {
      ...message,
    }
    const messageKey = trackedMessageKey(message.thread_id, message.id)
    const currentMessage = getOwnMessages(
      get().messages,
      message.thread_id
    )?.find((m) => m.id === message.id)
    if (!pendingMessageMutationIds.has(messageKey) && currentMessage) {
      persistedMessages.set(messageKey, currentMessage)
      latestSuccessfulMutationId.set(messageKey, 0)
      visibleMessageMutationId.set(messageKey, 0)
    }
    const mutationId = (latestMessageMutationId.get(messageKey) ?? 0) + 1
    latestMessageMutationId.set(messageKey, mutationId)
    const pendingMutations =
      pendingMessageMutationIds.get(messageKey) ?? new Set<number>()
    pendingMutations.add(mutationId)
    pendingMessageMutationIds.set(messageKey, pendingMutations)
    visibleMessageMutationId.set(messageKey, mutationId)

    // Roll back to the last backend-confirmed version rather than a prior optimistic edit.
    const previousMessage =
      persistedMessages.get(messageKey) ??
      currentMessage

    // Optimistically update state immediately for instant UI feedback
    set((state) => ({
      messages: {
        ...state.messages,
        [message.thread_id]: (
          getOwnMessages(state.messages, message.thread_id) ?? []
        ).map((m) => (m.id === message.id ? updatedMessage : m)),
      },
    }))

    // Persist to storage asynchronously — targeted rollback on failure
    getServiceHub()
      .messages()
      .modifyMessage(updatedMessage)
      .then((persistedMessage) => {
        const remainingPendingMutations =
          pendingMessageMutationIds.get(messageKey)
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
        if (higherPendingExists || currentVisible > mutationId) {
          cleanupTrackedMessageIfIdle(messageKey)
          return
        }

        visibleMessageMutationId.set(messageKey, mutationId)

        set((state) => ({
          messages: {
            ...state.messages,
            [message.thread_id]: (
              getOwnMessages(state.messages, message.thread_id) ?? []
            ).map((m) => (m.id === message.id ? persistedMessage : m)),
          },
        }))
        cleanupTrackedMessageIfIdle(messageKey)
      })
      .catch((error) => {
        console.error('Failed to persist message update:', error)
        const remainingPendingMutations =
          pendingMessageMutationIds.get(messageKey)
        remainingPendingMutations?.delete(mutationId)
        if (!remainingPendingMutations?.size) {
          pendingMessageMutationIds.delete(messageKey)
        }

        if ((visibleMessageMutationId.get(messageKey) ?? 0) !== mutationId) {
          cleanupTrackedMessageIfIdle(messageKey)
          return
        }

        visibleMessageMutationId.set(
          messageKey,
          latestSuccessfulMutationId.get(messageKey) ?? 0
        )
        const rollbackMessage =
          persistedMessages.get(messageKey) ?? previousMessage
        if (rollbackMessage) {
          set((state) => ({
            messages: {
              ...state.messages,
              [message.thread_id]: (
                getOwnMessages(state.messages, message.thread_id) ?? []
              ).map((m) => (m.id === message.id ? rollbackMessage : m)),
            },
          }))
        }
        cleanupTrackedMessageIfIdle(messageKey)
      })
  },
  updateMessages: (messages) => {
    if (messages.length === 0) return

    const mutations = messages.map((message) => {
      const key = trackedMessageKey(message.thread_id, message.id)
      const currentMessage = getOwnMessages(
        get().messages,
        message.thread_id
      )?.find((candidate) => candidate.id === message.id)
      if (!pendingMessageMutationIds.has(key) && currentMessage) {
        persistedMessages.set(key, currentMessage)
        latestSuccessfulMutationId.set(key, 0)
        visibleMessageMutationId.set(key, 0)
      }
      const mutationId = (latestMessageMutationId.get(key) ?? 0) + 1
      latestMessageMutationId.set(key, mutationId)
      const pending = pendingMessageMutationIds.get(key) ?? new Set<number>()
      pending.add(mutationId)
      pendingMessageMutationIds.set(key, pending)
      visibleMessageMutationId.set(key, mutationId)
      return { message, key, mutationId, previousMessage: currentMessage }
    })

    const optimisticByThread = new Map<string, Map<string, ThreadMessage>>()
    for (const { message } of mutations) {
      const replacements =
        optimisticByThread.get(message.thread_id) ?? new Map<string, ThreadMessage>()
      replacements.set(message.id, message)
      optimisticByThread.set(message.thread_id, replacements)
    }
    set((state) => {
      const nextMessages = { ...state.messages }
      for (const [threadId, replacements] of optimisticByThread) {
        nextMessages[threadId] = (
          getOwnMessages(state.messages, threadId) ?? []
        ).map((message) => replacements.get(message.id) ?? message)
      }
      return { messages: nextMessages }
    })

    getServiceHub()
      .messages()
      .modifyMessages(messages)
      .then((persistedBatch) => {
        const persistedByKey = new Map(
          persistedBatch.map((message) => [
            trackedMessageKey(message.thread_id, message.id),
            message,
          ])
        )
        const visibleByThread = new Map<string, Map<string, ThreadMessage>>()

        for (const { message, key, mutationId } of mutations) {
          const pending = pendingMessageMutationIds.get(key)
          pending?.delete(mutationId)
          if (!pending?.size) pendingMessageMutationIds.delete(key)

          const persistedMessage = persistedByKey.get(key) ?? message
          const latestSuccess = latestSuccessfulMutationId.get(key) ?? 0
          if (mutationId >= latestSuccess) {
            persistedMessages.set(key, persistedMessage)
            latestSuccessfulMutationId.set(key, mutationId)
          }

          const higherPendingExists = Array.from(
            pendingMessageMutationIds.get(key) ?? []
          ).some((pendingId) => pendingId > mutationId)
          const currentVisible = visibleMessageMutationId.get(key) ?? 0
          if (!higherPendingExists && currentVisible <= mutationId) {
            visibleMessageMutationId.set(key, mutationId)
            const replacements =
              visibleByThread.get(message.thread_id) ??
              new Map<string, ThreadMessage>()
            replacements.set(message.id, persistedMessage)
            visibleByThread.set(message.thread_id, replacements)
          }
          cleanupTrackedMessageIfIdle(key)
        }

        if (visibleByThread.size > 0) {
          set((state) => {
            const nextMessages = { ...state.messages }
            for (const [threadId, replacements] of visibleByThread) {
              nextMessages[threadId] = (
                getOwnMessages(state.messages, threadId) ?? []
              ).map((message) => replacements.get(message.id) ?? message)
            }
            return { messages: nextMessages }
          })
        }
      })
      .catch((error) => {
        console.error('Failed to persist message updates:', error)
        const rollbackByThread = new Map<string, Map<string, ThreadMessage>>()
        for (const { message, key, mutationId, previousMessage } of mutations) {
          const pending = pendingMessageMutationIds.get(key)
          pending?.delete(mutationId)
          if (!pending?.size) pendingMessageMutationIds.delete(key)

          if ((visibleMessageMutationId.get(key) ?? 0) === mutationId) {
            visibleMessageMutationId.set(
              key,
              latestSuccessfulMutationId.get(key) ?? 0
            )
            const rollbackMessage =
              persistedMessages.get(key) ?? previousMessage
            if (rollbackMessage) {
              const replacements =
                rollbackByThread.get(message.thread_id) ??
                new Map<string, ThreadMessage>()
              replacements.set(message.id, rollbackMessage)
              rollbackByThread.set(message.thread_id, replacements)
            }
          }
          cleanupTrackedMessageIfIdle(key)
        }

        if (rollbackByThread.size > 0) {
          set((state) => {
            const nextMessages = { ...state.messages }
            for (const [threadId, replacements] of rollbackByThread) {
              nextMessages[threadId] = (
                getOwnMessages(state.messages, threadId) ?? []
              ).map((message) => replacements.get(message.id) ?? message)
            }
            return { messages: nextMessages }
          })
        }
      })
  },
  deleteMessage: (threadId, messageId) => {
    const previousMessage = getOwnMessages(get().messages, threadId)?.find(
      (m) => m.id === messageId
    )
    // Optimistic update
    set((state) => ({
      messages: {
        ...state.messages,
        [threadId]:
          getOwnMessages(state.messages, threadId)?.filter(
            (message) => message.id !== messageId
          ) || [],
      },
    }))
    getServiceHub()
      .messages()
      .deleteMessage(threadId, messageId)
      .then(() => {
        removeTrackedMessage(threadId, messageId)
      })
      .catch((error) => {
        console.error('Failed to delete message, rolling back:', error)
        // Re-insert only the single deleted message using the CURRENT state.
        // Don't replay a full pre-delete snapshot — that would overwrite any
        // messages (assistant replies, follow-ups) that arrived during the
        // failed API-call window.
        if (!previousMessage) return
        set((state) => {
          const currentList = getOwnMessages(state.messages, threadId) ?? []
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
  removeThreadMessages: (threadId) => {
    clearTrackedThreadMessages(threadId)
    set((state) => {
      if (!Object.prototype.hasOwnProperty.call(state.messages, threadId)) {
        return state
      }
      const { [threadId]: _removed, ...remainingMessages } = state.messages
      return { messages: remainingMessages }
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
