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

const threadPersistenceQueues = new Map<string, Promise<void>>()

function persistThreadUpdate(
  thread: Thread,
  onError: (error: unknown) => void
) {
  const previous = threadPersistenceQueues.get(thread.id)
  const run = () => getServiceHub().threads().updateThread(thread)
  let pending: Promise<void>
  try {
    pending = previous
      ? previous.catch(() => undefined).then(run)
      : Promise.resolve(run())
  } catch (error) {
    pending = Promise.reject(error)
  }

  threadPersistenceQueues.set(thread.id, pending)
  void pending
    .catch(onError)
    .finally(() => {
      if (threadPersistenceQueues.get(thread.id) === pending) {
        threadPersistenceQueues.delete(thread.id)
      }
    })
}

function cleanupThreadResources(threadId: string) {
  useChatSessions.getState().removeSession(threadId)
  useMessages.getState().removeThreadMessages(threadId)
  getServiceHub().threads().deleteThread(threadId).catch(console.error)
  const colId = threadCollectionId(threadId)
  useFileRegistry.getState().clearCollection(colId)
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
  threadsToDelete: Set<string>
) {
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
    const thread = getOwnThread(get().threads, threadId)
    if (!thread) return
    const updatedThread = {
      ...thread,
      isFavorite: !thread.isFavorite,
      updated: Math.floor(Date.now() / 1000),
    }
    set((state) => ({
      threads: {
        ...state.threads,
        [threadId]: updatedThread,
      },
    }))
    // Persist outside of set() to avoid side-effects in the updater
    persistThreadUpdate(
      updatedThread,
      reportPersistenceError('toggle favorite')
    )
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
    const threadIds = Object.values(get().threads)
      .filter((thread) => !thread.isFavorite && !thread.metadata?.project)
      .map((thread) => thread.id)
    threadIds.forEach(cleanupThreadResources)
    const threadsToDelete = new Set(threadIds)
    set((state) => deleteThreadsFromState(state, threadsToDelete))
  },
  clearAllThreads: () => {
    const threadIds = Object.keys(get().threads)
    threadIds.forEach(cleanupThreadResources)
    const threadsToDelete = new Set(threadIds)
    set((state) => deleteThreadsFromState(state, threadsToDelete))
  },
  deleteAllThreadsByProject: (projectId) => {
    const threadIds = Object.values(get().threads)
      .filter((thread) => thread.metadata?.project?.id === projectId)
      .map((thread) => thread.id)
    threadIds.forEach(cleanupThreadResources)
    const threadsToDelete = new Set(threadIds)
    set((state) => deleteThreadsFromState(state, threadsToDelete))
  },
  unstarAllThreads: () => {
    const currentThreads = get().threads
    const updatedThreads = Object.fromEntries(
      Object.entries(currentThreads).map(([threadId, thread]) => [
        threadId,
        {
          ...thread,
          isFavorite: false,
        },
      ])
    ) as Record<string, Thread>
    set({ threads: updatedThreads })
    // Persist outside of set() to avoid side-effects in the updater
    Object.values(updatedThreads).forEach((thread) => {
      persistThreadUpdate(
        { ...thread, isFavorite: false },
        reportPersistenceError('unstar thread')
      )
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
    const { currentThreadId, getCurrentThread } = get()
    if (!currentThreadId) return
    const currentThread = getCurrentThread()
    if (!currentThread) return
    const updatedThread = {
      ...currentThread,
      assistants: assistant ? [assistant] : [],
      updated: Math.floor(Date.now() / 1000),
    }
    set((state) => ({
      threads: {
        ...state.threads,
        [currentThreadId]: updatedThread,
      },
    }))
    persistThreadUpdate(
      {
        ...updatedThread,
        assistants: assistant
          ? [{ ...assistant, model: currentThread.model }]
          : [],
      },
      reportPersistenceError('update thread assistant')
    )
  },
  updateCurrentThreadModel: (model) => {
    const { currentThreadId, getCurrentThread } = get()
    if (!currentThreadId) return
    const currentThread = getCurrentThread()
    if (!currentThread) return
    const updatedThread = { ...currentThread, model }
    set((state) => ({
      threads: {
        ...state.threads,
        [currentThreadId]: updatedThread,
      },
    }))
    // Persist outside of set() to avoid side-effects in the updater
    persistThreadUpdate(
      updatedThread,
      reportPersistenceError('update thread model')
    )
  },
  renameThread: (threadId, newTitle) => {
    const thread = getOwnThread(get().threads, threadId)
    if (!thread) return
    const updatedThread = {
      ...thread,
      title: newTitle,
      updated: Math.floor(Date.now() / 1000),
    }
    set((state) => {
      const newThreads = { ...state.threads, [threadId]: updatedThread }
      return {
        threads: newThreads,
        searchIndex: buildSearchIndex(newThreads),
      }
    })
    // Persist outside of set() to avoid side-effects in the updater
    persistThreadUpdate(updatedThread, reportPersistenceError('rename thread'))
  },
  getCurrentThread: () => {
    const { currentThreadId, threads } = get()
    return currentThreadId
      ? getOwnThread(threads, currentThreadId)
      : undefined
  },
  updateThreadTimestamp: (threadId) => {
    const thread = getOwnThread(get().threads, threadId)
    if (!thread) return
    const updatedThread = {
      ...thread,
      updated: Math.floor(Date.now() / 1000),
    }
    set((state) => ({
      threads: { ...state.threads, [threadId]: updatedThread },
    }))
    // Background timestamp refresh — log but don't toast; the user didn't
    // explicitly initiate this, so a failed background save shouldn't nag.
    persistThreadUpdate(updatedThread, (error) => {
      console.error('[threads] timestamp persist failed:', error)
    })
  },
  updateThread: (threadId, updates) => {
    const thread = getOwnThread(get().threads, threadId)
    if (!thread) return
    const updatedThread = {
      ...thread,
      ...updates,
      updated: Math.floor(Date.now() / 1000),
    }
    const titleChanged =
      updates.title !== undefined && updates.title !== thread.title
    set((state) => {
      const newThreads = { ...state.threads, [threadId]: updatedThread }
      return {
        threads: newThreads,
        ...(titleChanged && { searchIndex: buildSearchIndex(newThreads) }),
      }
    })
    persistThreadUpdate(updatedThread, reportPersistenceError('update thread'))
  },
}))
