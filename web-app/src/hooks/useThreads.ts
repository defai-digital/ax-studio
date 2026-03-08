import { create } from 'zustand'
import { ulid } from 'ulidx'
import { getServiceHub } from '@/hooks/useServiceHub'
import { Fzf } from 'fzf'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
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
  updateCurrentThreadAssistant: (assistant: Assistant) => void
  updateThreadTimestamp: (threadId: string) => void
  updateThread: (threadId: string, updates: Partial<Thread>) => void
  deleteAllThreadsByProject: (projectId: string) => void
  searchIndex: Fzf<Thread[]> | null
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
    // Filter out temporary chat for search index
    const filteredForSearch = Object.values(threadMap).filter(
      (t) => t.id !== TEMPORARY_CHAT_ID
    )

    set({
      threads: threadMap,
      searchIndex: new Fzf<Thread[]>(filteredForSearch, {
        selector: (item: Thread) => item.title,
      }),
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
    if (!currentIndex?.find) {
      currentIndex = new Fzf<Thread[]>(filteredThreadsValues, {
        selector: (item: Thread) => item.title,
      })
      set({ searchIndex: currentIndex })
    }

    // Use the index to search and return matching threads
    const fzfResults = currentIndex.find(searchTerm)
    return fzfResults.map(
      (result: { item: Thread; positions: Set<number> }) => {
        const thread = result.item // Fzf stores the original item here

        return {
          ...thread,
          title: thread.title, // Override title with highlighted version
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
        .catch(console.error)
      return {
        threads: {
          ...state.threads,
          [threadId]: {
            ...state.threads[threadId],
            isFavorite: !state.threads[threadId].isFavorite,
            updated: Date.now() / 1000,
          },
        },
      }
    })
  },
  deleteThread: (threadId) => {
    set((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [threadId]: _, ...remainingThreads } = state.threads

      getServiceHub().threads().deleteThread(threadId).catch(console.error)

      return {
        threads: remainingThreads,
        searchIndex: new Fzf<Thread[]>(
          Object.values(remainingThreads).filter(
            (t) => t.id !== TEMPORARY_CHAT_ID
          ),
          {
            selector: (item: Thread) => item.title,
          }
        ),
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

      // Delete threads
      threadsToDeleteIds.forEach((threadId) => {
        getServiceHub().threads().deleteThread(threadId).catch(console.error)
      })

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
        searchIndex: new Fzf<Thread[]>(
          Object.values(remainingThreads).filter(
            (t) => t.id !== TEMPORARY_CHAT_ID
          ),
          {
            selector: (item: Thread) => item.title,
          }
        ),
      }
    })
  },
  clearAllThreads: () => {
    set((state) => {
      const allThreadIds = Object.keys(state.threads)

      // Delete all threads
      allThreadIds.forEach((threadId) => {
        getServiceHub().threads().deleteThread(threadId).catch(console.error)
      })

      return {
        threads: {},
        currentThreadId: undefined,
        searchIndex: new Fzf<Thread[]>([], {
          selector: (item: Thread) => item.title,
        }),
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

      // Delete threads belonging to this project
      threadsToDeleteIds.forEach((threadId) => {
        getServiceHub().threads().deleteThread(threadId).catch(console.error)
      })

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
        searchIndex: new Fzf<Thread[]>(Object.values(remainingThreads).filter(t => t.id !== TEMPORARY_CHAT_ID), {
          selector: (item: Thread) => item.title,
        }),
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
  createThread: async (
    model,
    title,
    assistant,
    projectMetadata,
    isTemporary
  ) => {
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
      updated: Date.now() / 1000,
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
          // Get all existing threads as an array
          const existingThreads = Object.values(state.threads)

          // Create new array with the new thread at the beginning
          const reorderedThreads = [createdThread, ...existingThreads]

          // Use setThreads to handle proper ordering (this will assign order 1, 2, 3...)
          get().setThreads(reorderedThreads)

          return {
            currentThreadId: createdThread.id,
          }
        })
        return createdThread
      })
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
          .catch(console.error)
      return {
        threads: {
          ...state.threads,
          [state.currentThreadId as string]: {
            ...state.threads[state.currentThreadId as string],
            assistants: assistant ? [assistant] : [],
            updated: Date.now() / 1000,
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
          .catch(console.error)
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
        updated: Date.now() / 1000,
      }
      getServiceHub().threads().updateThread(updatedThread).catch(console.error)
      const newThreads = { ...state.threads, [threadId]: updatedThread }
      return {
        threads: newThreads,
        searchIndex: new Fzf<Thread[]>(
          Object.values(newThreads).filter((t) => t.id !== TEMPORARY_CHAT_ID),
          {
            selector: (item: Thread) => item.title,
          }
        ),
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
        updated: Date.now() / 1000,
      }

      // Update all other threads to increment their order by 1
      const updatedThreads = { ...state.threads }
      updatedThreads[threadId] = updatedThread

      // Update the backend for the main thread
      getServiceHub().threads().updateThread(updatedThread).catch(console.error)

      return {
        threads: updatedThreads,
        searchIndex: new Fzf<Thread[]>(
          Object.values(updatedThreads).filter(
            (t) => t.id !== TEMPORARY_CHAT_ID
          ),
          {
            selector: (item: Thread) => item.title,
          }
        ),
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
        updated: Date.now() / 1000,
      }

      getServiceHub().threads().updateThread(updatedThread).catch(console.error)

      const newThreads = { ...state.threads, [threadId]: updatedThread }
      return {
        threads: newThreads,
        searchIndex: new Fzf<Thread[]>(
          Object.values(newThreads).filter((t) => t.id !== TEMPORARY_CHAT_ID),
          {
            selector: (item: Thread) => item.title,
          }
        ),
      }
    })
  },
}))
