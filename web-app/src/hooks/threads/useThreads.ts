import { create } from 'zustand'
import { ulid } from 'ulidx'
import { toast } from 'sonner'
import { getServiceHub } from '@/hooks/useServiceHub'
import Fuse, { type FuseResult } from 'fuse.js'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { useGeneralSetting } from '@/hooks/settings/useGeneralSetting'
import { useFileRegistry, threadCollectionId } from '@/lib/file-registry'
import { useChatSessions } from '@/stores/chat-session-store'
import { useMessages } from '@/hooks/chat/useMessages'
import { useAppState } from '@/hooks/settings/useAppState'

const buildSearchIndex = (threads: Record<string, Thread>): Fuse<Thread> => {
  const entries = Object.values(threads).filter((t) => t.id !== TEMPORARY_CHAT_ID)
  return new Fuse(entries, {
    keys: ['title'],
    threshold: 0.4,
    includeScore: true,
  })
}

const getOwnThread = (
  threads: Record<string, Thread>,
  threadId: string
): Thread | undefined => {
  return Object.prototype.hasOwnProperty.call(threads, threadId)
    ? threads[threadId]
    : undefined
}

const reportPersistenceError = (operation: string) => (error: unknown) => {
  console.error(`[threads] ${operation} persistence failed:`, error)
  toast.error(`Failed to save: ${operation}`, {
    id: `threads-persist-${operation}`,
  })
}

function cleanupThreadResources(threadId: string) {
  useAppState.getState().cancelToolCall(threadId)
  useAppState.getState().clearToolCallCancellation(threadId)
  useChatSessions.getState().removeSession(threadId)
  useMessages.getState().removeThreadMessages(threadId)
  getServiceHub().threads().deleteThread(threadId).catch(console.error)
  const colId = threadCollectionId(threadId)
  useFileRegistry.getState().clearCollection(colId)
  getServiceHub().mcp().callTool({
    toolName: 'akidb_delete_collection',
    arguments: { collection_id: colId },
  }).catch(() => {})
}

/** Deduplicate only genuinely identical concurrent creates. */
const createThreadInFlightPromises = new Map<string, Promise<Thread>>()
let activeThreadCreateCount = 0

const createThreadRequestKey = (
  model: ThreadModel,
  title: string | undefined,
  assistant: Assistant | undefined,
  projectMetadata: {
    id: string
    name: string
    updated_at: number
    logo?: string
    projectPrompt?: string | null
  } | undefined
) => JSON.stringify({ model, title, assistant, projectMetadata })
type ThreadState = {
  threads: Record<string, Thread>
  currentThreadId?: string
  getCurrentThread: () => Thread | undefined
  setThreads: (threads: Thread[]) => void
  getFavoriteThreads: () => Thread[]
  getThreadById: (threadId: string) => Thread | undefined
  toggleFavorite: (threadId: string) => void
  deleteThread: (threadId: string) => void
  renameThread: (threadId: string, newTitle: string) => void
  deleteAllThreads: () => void
  clearAllThreads: () => void
  unstarAllThreads: () => void
  setCurrentThreadId: (threadId?: string) => void
  createThread: (
    model: ThreadModel,
    title?: string,
    assistant?: Assistant,
    projectMetadata?: {
      id: string
      name: string
      updated_at: number
      logo?: string
      projectPrompt?: string | null
    },
    isTemporary?: boolean
  ) => Promise<Thread>
  updateCurrentThreadModel: (model: ThreadModel) => void
  getFilteredThreads: (searchTerm: string) => Thread[]
  updateCurrentThreadAssistant: (assistant: Assistant | undefined) => void
  updateThreadTimestamp: (threadId: string) => void
  updateThread: (threadId: string, updates: Partial<Thread>) => void
  deleteAllThreadsByProject: (projectId: string) => void
  searchIndex: Fuse<Thread> | null
  _createThreadInFlight: boolean
}

function deleteThreadsFromState(
  state: Pick<ThreadState, 'threads' | 'currentThreadId'>,
  shouldDelete: (thread: Thread) => boolean
) {
  const threadsToDeleteIds = Object.keys(state.threads).filter((threadId) =>
    shouldDelete(state.threads[threadId])
  )
  const threadsToDelete = new Set(threadsToDeleteIds)

  threadsToDeleteIds.forEach(cleanupThreadResources)

  const remainingThreads = Object.fromEntries(
    Object.entries(state.threads).filter(
      ([threadId]) => !threadsToDelete.has(threadId)
    )
  ) as Record<string, Thread>

  return {
    threads: remainingThreads,
    currentThreadId:
      state.currentThreadId && threadsToDelete.has(state.currentThreadId)
        ? undefined
        : state.currentThreadId,
    searchIndex: buildSearchIndex(remainingThreads),
  }
}

export const useThreads = create<ThreadState>()((set, get) => ({
  threads: {},
  searchIndex: null,
  setThreads: (threads) => {
    const normalizedThreads = Object.fromEntries(
      threads.map((thread) => [
        thread.id,
        {
          ...thread,
          model: thread.model
            ? {
                provider: thread.model?.provider,
                id: thread.model?.id,
              }
            : undefined,
        },
      ])
    ) as Record<string, Thread>

    set((state) => {
      const mergedThreads = {
        ...normalizedThreads,
        ...state.threads,
      }

      return {
        threads: mergedThreads,
        searchIndex: buildSearchIndex(mergedThreads),
      }
    })
  },
  getFilteredThreads: (searchTerm: string) => {
    const { threads, searchIndex } = get()

    // Filter out temporary chat from all operations
    const filteredThreadsValues = Object.values(threads).filter(
      (t) => t.id !== TEMPORARY_CHAT_ID
    )

    // If no search term, return all threads
    if (!searchTerm) {
      // return all threads
      return filteredThreadsValues
    }

    let currentIndex = searchIndex
    if (!currentIndex?.search) {
      currentIndex = buildSearchIndex(threads)
      set({ searchIndex: currentIndex })
    }

    // Use the index to search and return matching threads
    const fuseResults = currentIndex.search(searchTerm)
    return fuseResults.map(
      (result: FuseResult<Thread>) => {
        return {
          ...result.item,
        }
      }
    )
  },
  toggleFavorite: (threadId) => {
    set((state) => {
      const thread = getOwnThread(state.threads, threadId)
      if (!thread) return state
      getServiceHub()
        .threads()
        .updateThread({
          ...thread,
          isFavorite: !thread.isFavorite,
        })
        .catch(reportPersistenceError('toggle favorite'))
      return {
        threads: {
          ...state.threads,
          [threadId]: {
            ...thread,
            isFavorite: !thread.isFavorite,
            updated: Math.floor(Date.now() / 1000),
          },
        },
      }
    })
  },
  deleteThread: (threadId) => {
    cleanupThreadResources(threadId)

    set((state) => {
      const { [threadId]: _, ...remainingThreads } = state.threads

      return {
        threads: remainingThreads,
        currentThreadId:
          state.currentThreadId === threadId ? undefined : state.currentThreadId,
        searchIndex: buildSearchIndex(remainingThreads),
      }
    })
  },
  deleteAllThreads: () => {
    set((state) =>
      deleteThreadsFromState(
        state,
        (thread) => !thread.isFavorite && !thread.metadata?.project
      )
    )
  },
  clearAllThreads: () => {
    set((state) => deleteThreadsFromState(state, () => true))
  },
  deleteAllThreadsByProject: (projectId) => {
    set((state) =>
      deleteThreadsFromState(
        state,
        (thread) => thread.metadata?.project?.id === projectId
      )
    )
  },
  unstarAllThreads: () => {
    set((state) => {
      const updatedThreads = Object.fromEntries(
        Object.entries(state.threads).map(([threadId, thread]) => [
          threadId,
          {
            ...thread,
            isFavorite: false,
          },
        ])
      ) as Record<string, Thread>
      Object.values(updatedThreads).forEach((thread) => {
        getServiceHub()
          .threads()
          .updateThread({ ...thread, isFavorite: false })
          .catch(console.error)
      })
      return { threads: updatedThreads }
    })
  },
  getFavoriteThreads: () => {
    return Object.values(get().threads).filter((thread) => thread.isFavorite)
  },
  getThreadById: (threadId: string) => {
    return getOwnThread(get().threads, threadId)
  },
  setCurrentThreadId: (threadId) => {
    if (threadId !== get().currentThreadId) set({ currentThreadId: threadId })
  },
  _createThreadInFlight: false,
  createThread: async (
    model,
    title,
    assistant,
    projectMetadata,
    isTemporary
  ) => {
    const requestKey = !isTemporary
      ? createThreadRequestKey(model, title, assistant, projectMetadata)
      : undefined
    const existingCreate = requestKey
      ? createThreadInFlightPromises.get(requestKey)
      : undefined
    if (existingCreate) {
      return existingCreate
    }

    const run = async (): Promise<Thread> => {
      const generalSettings = useGeneralSetting.getState()
        const shouldSnapshotGlobalPrompt =
          generalSettings.applyMode === 'new_chats_only' &&
          Boolean(generalSettings.globalDefaultPrompt.trim()) &&
          !projectMetadata?.projectPrompt

        const baseMetadata = {
          ...(projectMetadata && { project: projectMetadata }),
          ...(shouldSnapshotGlobalPrompt && {
            threadPrompt: generalSettings.globalDefaultPrompt.trim(),
          }),
        }

        const newThread: Thread = {
          id: isTemporary ? TEMPORARY_CHAT_ID : ulid(),
          title: title ?? (isTemporary ? 'Temporary Chat' : 'New Thread'),
          model,
          updated: Math.floor(Date.now() / 1000),
          assistants: assistant ? [assistant] : [],
          ...(projectMetadata &&
            !isTemporary && {
              metadata: baseMetadata,
            }),
          ...(isTemporary && {
            metadata: {
              isTemporary: true,
              ...baseMetadata,
            },
          }),
          ...(!projectMetadata &&
            !isTemporary &&
            Object.keys(baseMetadata).length > 0 && { metadata: baseMetadata }),
        }

        const createdThread = await getServiceHub()
          .threads()
          .createThread(newThread)

        set((state) => {
          const existingThreads = Object.values(state.threads)
          const reorderedThreads = [createdThread, ...existingThreads]

          const threadMap = Object.fromEntries(
            reorderedThreads.map((thread) => [
              thread.id,
              {
                ...thread,
                model: thread.model
                  ? { provider: thread.model?.provider, id: thread.model?.id }
                  : undefined,
              },
            ])
          ) as Record<string, Thread>

          return {
            threads: threadMap,
            searchIndex: buildSearchIndex(threadMap),
            currentThreadId: createdThread.id,
          }
        })
      return createdThread
    }

    activeThreadCreateCount += 1
    set({ _createThreadInFlight: true })
    const pendingCreate = run().finally(() => {
      activeThreadCreateCount = Math.max(0, activeThreadCreateCount - 1)
      if (
        requestKey &&
        createThreadInFlightPromises.get(requestKey) === pendingCreate
      ) {
        createThreadInFlightPromises.delete(requestKey)
      }
      set({ _createThreadInFlight: activeThreadCreateCount > 0 })
    })
    if (requestKey) {
      createThreadInFlightPromises.set(requestKey, pendingCreate)
    }
    return pendingCreate
  },
  updateCurrentThreadAssistant: (assistant) => {
    set((state) => {
      if (!state.currentThreadId) return state
      const currentThread = state.getCurrentThread()
      if (!currentThread) return state
      getServiceHub()
        .threads()
        .updateThread({
          ...currentThread,
          assistants: assistant
            ? [{ ...assistant, model: currentThread.model }]
            : [],
        })
        .catch(reportPersistenceError('update thread assistant'))
      return {
        threads: {
          ...state.threads,
          [state.currentThreadId as string]: {
            ...currentThread,
            assistants: assistant ? [assistant] : [],
            updated: Math.floor(Date.now() / 1000),
          },
        },
      }
    })
  },
  updateCurrentThreadModel: (model) => {
    set((state) => {
      if (!state.currentThreadId) return state
      const currentThread = state.getCurrentThread()
      if (!currentThread) return state
      getServiceHub()
        .threads()
        .updateThread({ ...currentThread, model })
        .catch(reportPersistenceError('update thread model'))
      return {
        threads: {
          ...state.threads,
          [state.currentThreadId as string]: {
            ...currentThread,
            model,
          },
        },
      }
    })
  },
  renameThread: (threadId, newTitle) => {
    set((state) => {
      const thread = getOwnThread(state.threads, threadId)
      if (!thread) return state
      const updatedThread = {
        ...thread,
        title: newTitle,
        updated: Math.floor(Date.now() / 1000),
      }
      getServiceHub()
        .threads()
        .updateThread(updatedThread)
        .catch(reportPersistenceError('rename thread'))
      const newThreads = { ...state.threads, [threadId]: updatedThread }
      return {
        threads: newThreads,
        searchIndex: buildSearchIndex(newThreads),
      }
    })
  },
  getCurrentThread: () => {
    const { currentThreadId, threads } = get()
    return currentThreadId
      ? getOwnThread(threads, currentThreadId)
      : undefined
  },
  updateThreadTimestamp: (threadId) => {
    set((state) => {
      const thread = getOwnThread(state.threads, threadId)
      if (!thread) return state

      // Update the thread with new timestamp and set it to order 1 (top)
      const updatedThread = {
        ...thread,
        updated: Math.floor(Date.now() / 1000),
      }

      // Update all other threads to increment their order by 1
      const updatedThreads = { ...state.threads }
      updatedThreads[threadId] = updatedThread

      // Background timestamp refresh — log but don't toast; the user
      // didn't explicitly initiate this, so a failed background save
      // shouldn't nag them.
      getServiceHub()
        .threads()
        .updateThread(updatedThread)
        .catch((error) => {
          console.error('[threads] timestamp persist failed:', error)
        })

      // The Fuse index is keyed on `title`, not `updated`, so a bare
      // timestamp refresh doesn't need the O(n) rebuild — reuse the
      // existing index.
      return {
        threads: updatedThreads,
      }
    })
  },
  updateThread: (threadId, updates) => {
    set((state) => {
      const thread = getOwnThread(state.threads, threadId)
      if (!thread) return state

      const updatedThread = {
        ...thread,
        ...updates,
        updated: Math.floor(Date.now() / 1000),
      }

      getServiceHub()
        .threads()
        .updateThread(updatedThread)
        .catch(reportPersistenceError('update thread'))

      const newThreads = { ...state.threads, [threadId]: updatedThread }
      // The Fuse index is keyed on `title` only. Skip the O(n) rebuild when
      // the update does not change the title (e.g. model switch, metadata).
      const titleChanged =
        updates.title !== undefined && updates.title !== thread.title
      return {
        threads: newThreads,
        ...(titleChanged && { searchIndex: buildSearchIndex(newThreads) }),
      }
    })
  },
}))
