import { create } from 'zustand'
import { ulid } from 'ulidx'
import { toast } from 'sonner'
import { getServiceHub } from '@/hooks/useServiceHub'
import Fuse, { type FuseResult } from 'fuse.js'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { useGeneralSetting } from '@/hooks/settings/useGeneralSetting'
import { useFileRegistry, threadCollectionId } from '@/lib/file-registry'

const buildSearchIndex = (threads: Record<string, Thread>): Fuse<Thread> => {
  const entries = Object.values(threads).filter((t) => t.id !== TEMPORARY_CHAT_ID)
  return new Fuse(entries, {
    keys: ['title'],
    threshold: 0.4,
    includeScore: true,
  })
}

const reportPersistenceError = (operation: string) => (error: unknown) => {
  console.error(`[threads] ${operation} persistence failed:`, error)
  toast.error(`Failed to save: ${operation}`, {
    id: `threads-persist-${operation}`,
  })
}

function cleanupThreadResources(threadId: string) {
  getServiceHub().threads().deleteThread(threadId).catch(console.error)
  const colId = threadCollectionId(threadId)
  useFileRegistry.getState().clearCollection(colId)
  getServiceHub().mcp().callTool({
    toolName: 'akidb_delete_collection',
    arguments: { collection_id: colId },
  }).catch(() => {})
}
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

export const useThreads = create<ThreadState>()((set, get) => ({
  threads: {},
  searchIndex: null,
  setThreads: (threads) => {
    const threadMap = threads.reduce(
      (acc: Record<string, Thread>, thread) => {
        acc[thread.id] = {
          ...thread,
          model: thread.model
            ? {
                provider: thread.model?.provider,
                id: thread.model?.id,
              }
            : undefined,
        }
        return acc
      },
      {} as Record<string, Thread>
    )
    set({
      threads: threadMap,
      searchIndex: buildSearchIndex(threadMap),
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
      if (!state.threads[threadId]) return state
      getServiceHub()
        .threads()
        .updateThread({
          ...state.threads[threadId],
          isFavorite: !state.threads[threadId].isFavorite,
        })
        .catch(reportPersistenceError('toggle favorite'))
      return {
        threads: {
          ...state.threads,
          [threadId]: {
            ...state.threads[threadId],
            isFavorite: !state.threads[threadId].isFavorite,
            updated: Math.floor(Date.now() / 1000),
          },
        },
      }
    })
  },
  deleteThread: (threadId) => {
    cleanupThreadResources(threadId)

    import('@/hooks/chat/useMessages').then(({ clearTrackedThreadMessages }) => {
      clearTrackedThreadMessages(threadId)
    }).catch(() => {})

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
    set((state) => {
      const allThreadIds = Object.keys(state.threads)

      // Identify threads to keep (favorites OR have project metadata)
      const threadsToKeepIds = allThreadIds.filter(
        (threadId) =>
          state.threads[threadId].isFavorite ||
          state.threads[threadId].metadata?.project
      )

      // Identify threads to delete (non-favorites AND no project metadata)
      const threadsToDeleteIds = allThreadIds.filter(
        (threadId) =>
          !state.threads[threadId].isFavorite &&
          !state.threads[threadId].metadata?.project
      )

      threadsToDeleteIds.forEach(cleanupThreadResources)

      // Keep favorite threads and threads with project metadata
      const remainingThreads = threadsToKeepIds.reduce(
        (acc, threadId) => {
          acc[threadId] = state.threads[threadId]
          return acc
        },
        {} as Record<string, Thread>
      )

      return {
        threads: remainingThreads,
        // Drop the active-thread pointer if it's among the ones being
        // deleted so the UI doesn't sit on a ghost thread.
        currentThreadId:
          state.currentThreadId && threadsToDeleteIds.includes(state.currentThreadId)
            ? undefined
            : state.currentThreadId,
        searchIndex: buildSearchIndex(remainingThreads),
      }
    })
  },
  clearAllThreads: () => {
    set((state) => {
      const allThreadIds = Object.keys(state.threads)

      allThreadIds.forEach(cleanupThreadResources)

      return {
        threads: {},
        currentThreadId: undefined,
        searchIndex: buildSearchIndex({}),
      }
    })
  },
  deleteAllThreadsByProject: (projectId) => {
    set((state) => {
      const allThreadIds = Object.keys(state.threads)

      // Identify threads belonging to this project
      const threadsToDeleteIds = allThreadIds.filter(
        (threadId) =>
          state.threads[threadId].metadata?.project?.id === projectId
      )

      threadsToDeleteIds.forEach(cleanupThreadResources)

      // Keep threads that don't belong to this project
      const remainingThreads = allThreadIds
        .filter((threadId) => !threadsToDeleteIds.includes(threadId))
        .reduce(
          (acc, threadId) => {
            acc[threadId] = state.threads[threadId]
            return acc
          },
          {} as Record<string, Thread>
        )

      return {
        threads: remainingThreads,
        // Drop the active-thread pointer if the user was viewing a thread
        // that belonged to the project we just cleared.
        currentThreadId:
          state.currentThreadId && threadsToDeleteIds.includes(state.currentThreadId)
            ? undefined
            : state.currentThreadId,
        searchIndex: buildSearchIndex(remainingThreads),
      }
    })
  },
  unstarAllThreads: () => {
    set((state) => {
      const updatedThreads = Object.keys(state.threads).reduce(
        (acc, threadId) => {
          acc[threadId] = {
            ...state.threads[threadId],
            isFavorite: false,
          }
          return acc
        },
        {} as Record<string, Thread>
      )
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
    return get().threads[threadId]
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
    // Dedup guard: prevent concurrent duplicate thread creation (e.g., double-click)
    if (get()._createThreadInFlight && !isTemporary) {
      const currentThreadId = get().currentThreadId
      const currentThread = currentThreadId ? get().threads[currentThreadId] : undefined
      if (currentThread) return currentThread
    }
    set({ _createThreadInFlight: true })
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
    return await getServiceHub()
      .threads()
      .createThread(newThread)
      .then((createdThread) => {
        set((state) => {
          const existingThreads = Object.values(state.threads)
          const reorderedThreads = [createdThread, ...existingThreads]

          const threadMap = reorderedThreads.reduce(
            (acc: Record<string, Thread>, thread) => {
              acc[thread.id] = {
                ...thread,
                model: thread.model
                  ? { provider: thread.model?.provider, id: thread.model?.id }
                  : undefined,
              }
              return acc
            },
            {} as Record<string, Thread>
          )

          return {
            threads: threadMap,
            searchIndex: buildSearchIndex(threadMap),
            currentThreadId: createdThread.id,
          }
        })
        return createdThread
      })
      .finally(() => set({ _createThreadInFlight: false }))
  },
  updateCurrentThreadAssistant: (assistant) => {
    set((state) => {
      if (!state.currentThreadId) return { ...state }
      const currentThread = state.getCurrentThread()
      if (currentThread)
        getServiceHub()
          .threads()
          .updateThread({
            ...currentThread,
            assistants: assistant ? [{ ...assistant, model: currentThread.model }] : [],
          })
          .catch(reportPersistenceError('update thread assistant'))
      return {
        threads: {
          ...state.threads,
          [state.currentThreadId as string]: {
            ...state.threads[state.currentThreadId as string],
            assistants: assistant ? [assistant] : [],
            updated: Math.floor(Date.now() / 1000),
          },
        },
      }
    })
  },
  updateCurrentThreadModel: (model) => {
    set((state) => {
      if (!state.currentThreadId) return { ...state }
      const currentThread = state.getCurrentThread()
      if (currentThread)
        getServiceHub()
          .threads()
          .updateThread({ ...currentThread, model })
          .catch(reportPersistenceError('update thread model'))
      return {
        threads: {
          ...state.threads,
          [state.currentThreadId as string]: {
            ...state.threads[state.currentThreadId as string],
            model,
          },
        },
      }
    })
  },
  renameThread: (threadId, newTitle) => {
    set((state) => {
      const thread = state.threads[threadId]
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
    return currentThreadId ? threads[currentThreadId] : undefined
  },
  updateThreadTimestamp: (threadId) => {
    set((state) => {
      const thread = state.threads[threadId]
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
      const thread = state.threads[threadId]
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
      return {
        threads: newThreads,
        searchIndex: buildSearchIndex(newThreads),
      }
    })
  },
}))
