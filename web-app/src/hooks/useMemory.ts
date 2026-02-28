import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

export const MEMORY_LIMIT = 50

export type MemoryEntry = {
  id: string
  fact: string
  category?: string
  sourceThreadId: string
  createdAt: number
  updatedAt: number
}

type MemoryState = {
  memories: Record<string, MemoryEntry[]>
  memoryEnabled: boolean
  memoryVersion: number

  isMemoryEnabled: () => boolean
  toggleMemory: () => void
  addMemories: (userId: string, entries: MemoryEntry[]) => void
  replaceMemories: (userId: string, facts: string[], threadId: string) => void
  importMemories: (userId: string, entries: MemoryEntry[]) => void
  getMemories: (userId: string) => MemoryEntry[]
  updateMemory: (userId: string, memoryId: string, newFact: string) => void
  deleteMemory: (userId: string, memoryId: string) => void
  clearMemories: (userId: string) => void
}

export const useMemory = create<MemoryState>()(
  persist(
    (set, get) => ({
      memories: {},
      memoryEnabled: false,
      memoryVersion: 0,

      isMemoryEnabled: () => {
        return get().memoryEnabled
      },

      toggleMemory: () => {
        set((state) => ({
          memoryEnabled: !state.memoryEnabled,
        }))
      },

      addMemories: (userId: string, entries: MemoryEntry[]) => {
        if (entries.length === 0) return
        set((state) => {
          let combined = [...(state.memories[userId] || []), ...entries]
          if (combined.length > MEMORY_LIMIT) {
            combined.sort((a, b) => a.updatedAt - b.updatedAt)
            combined = combined.slice(combined.length - MEMORY_LIMIT)
          }
          return {
            memories: { ...state.memories, [userId]: combined },
            memoryVersion: state.memoryVersion + 1,
          }
        })
      },

      replaceMemories: (userId: string, facts: string[], threadId: string) => {
        const now = Date.now()
        let entries = facts.map((fact, i) => ({
          id: `mem-${now}-${i}`,
          fact,
          sourceThreadId: threadId,
          createdAt: now,
          updatedAt: now,
        }))
        if (entries.length > MEMORY_LIMIT) {
          entries = entries.slice(entries.length - MEMORY_LIMIT)
        }
        set((state) => ({
          memories: { ...state.memories, [userId]: entries },
          memoryVersion: state.memoryVersion + 1,
        }))
      },

      importMemories: (userId: string, entries: MemoryEntry[]) => {
        let limited = entries
        if (limited.length > MEMORY_LIMIT) {
          limited = [...entries].sort((a, b) => a.updatedAt - b.updatedAt).slice(entries.length - MEMORY_LIMIT)
        }
        set((state) => ({
          memories: { ...state.memories, [userId]: limited },
          memoryVersion: state.memoryVersion + 1,
        }))
      },

      getMemories: (userId: string) => {
        return get().memories[userId] || []
      },

      updateMemory: (userId: string, memoryId: string, newFact: string) => {
        set((state) => ({
          memories: {
            ...state.memories,
            [userId]: (state.memories[userId] || []).map((m) =>
              m.id === memoryId ? { ...m, fact: newFact, updatedAt: Date.now() } : m
            ),
          },
          memoryVersion: state.memoryVersion + 1,
        }))
      },

      deleteMemory: (userId: string, memoryId: string) => {
        set((state) => ({
          memories: {
            ...state.memories,
            [userId]: (state.memories[userId] || []).filter(
              (m) => m.id !== memoryId
            ),
          },
          memoryVersion: state.memoryVersion + 1,
        }))
      },

      clearMemories: (userId: string) => {
        set((state) => ({
          memories: {
            ...state.memories,
            [userId]: [],
          },
          memoryVersion: state.memoryVersion + 1,
        }))
      },
    }),
    {
      name: localStorageKey.memoryStore,
      storage: createJSONStorage(() => localStorage),
    }
  )
)
