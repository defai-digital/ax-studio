import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { createSafeJSONStorage } from '@/lib/storage'

type LocalKnowledgeState = {
  localKnowledgeEnabled: boolean
  localKnowledgeEnabledPerThread: Record<string, boolean>

  toggleLocalKnowledge: () => void
  toggleLocalKnowledgeForThread: (threadId: string) => void
  isLocalKnowledgeEnabledForThread: (threadId: string) => boolean
}

export const useLocalKnowledge = create<LocalKnowledgeState>()(
  persist(
    (set, get) => ({
      localKnowledgeEnabled: false,
      localKnowledgeEnabledPerThread: {},

      toggleLocalKnowledge: () => {
        set((state) => ({ localKnowledgeEnabled: !state.localKnowledgeEnabled }))
      },

      toggleLocalKnowledgeForThread: (threadId: string) => {
        set((state) => {
          const current =
            threadId in state.localKnowledgeEnabledPerThread
              ? state.localKnowledgeEnabledPerThread[threadId]
              : state.localKnowledgeEnabled
          return {
            localKnowledgeEnabledPerThread: {
              ...state.localKnowledgeEnabledPerThread,
              [threadId]: !current,
            },
          }
        })
      },

      isLocalKnowledgeEnabledForThread: (threadId: string) => {
        const state = get()
        if (threadId in state.localKnowledgeEnabledPerThread) {
          return state.localKnowledgeEnabledPerThread[threadId]
        }
        return state.localKnowledgeEnabled
      },
    }),
    {
      name: localStorageKey.localKnowledgeStore,
      storage: createSafeJSONStorage(() => localStorage, 'useLocalKnowledge'),
    }
  )
)
