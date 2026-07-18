import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { createSafeJSONStorage } from '@/lib/storage/storage'

type LocalKnowledgeState = {
  localKnowledgeEnabled: boolean
  localKnowledgeEnabledPerThread: Record<string, boolean>

  toggleLocalKnowledge: () => void
  toggleLocalKnowledgeForThread: (threadId: string) => void
  isLocalKnowledgeEnabledForThread: (threadId: string) => boolean
}

const MAX_THREAD_OVERRIDES = 200

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeThreadId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined

  const threadId = value.trim()
  return threadId === '' ? undefined : threadId
}

function normalizeThreadOverrides(value: unknown): Record<string, boolean> {
  if (!isPlainRecord(value)) return {}

  return Object.fromEntries(
    Object.entries(value)
      .map(
        ([threadId, enabled]) =>
          [normalizeThreadId(threadId), enabled] as const
      )
      .filter(
        (entry): entry is [string, boolean] =>
          entry[0] !== undefined && typeof entry[1] === 'boolean'
      )
      .slice(-MAX_THREAD_OVERRIDES)
  )
}

function getOwnThreadOverride(
  overrides: Record<string, boolean>,
  threadId: string
): boolean | undefined {
  return Object.prototype.hasOwnProperty.call(overrides, threadId)
    ? overrides[threadId]
    : undefined
}

function sanitizePersistedLocalKnowledge(
  persisted: unknown,
  current: LocalKnowledgeState
): LocalKnowledgeState {
  if (!isPlainRecord(persisted)) return current

  return {
    ...current,
    localKnowledgeEnabled:
      typeof persisted.localKnowledgeEnabled === 'boolean'
        ? persisted.localKnowledgeEnabled
        : current.localKnowledgeEnabled,
    localKnowledgeEnabledPerThread: normalizeThreadOverrides(
      persisted.localKnowledgeEnabledPerThread
    ),
  }
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
        const normalizedThreadId = normalizeThreadId(threadId)
        if (!normalizedThreadId) return

        set((state) => {
          const current =
            getOwnThreadOverride(
              state.localKnowledgeEnabledPerThread,
              normalizedThreadId
            ) ?? state.localKnowledgeEnabled
          return {
            localKnowledgeEnabledPerThread: {
              ...state.localKnowledgeEnabledPerThread,
              [normalizedThreadId]: !current,
            },
          }
        })
      },

      isLocalKnowledgeEnabledForThread: (threadId: string) => {
        const normalizedThreadId = normalizeThreadId(threadId)
        const state = get()
        if (normalizedThreadId) {
          const override = getOwnThreadOverride(
            state.localKnowledgeEnabledPerThread,
            normalizedThreadId
          )
          if (override !== undefined) return override
        }
        return state.localKnowledgeEnabled
      },
    }),
    {
      name: localStorageKey.localKnowledgeStore,
      storage: createSafeJSONStorage(() => localStorage, 'useLocalKnowledge'),
      merge: (persisted, current) =>
        sanitizePersistedLocalKnowledge(persisted, current),
      partialize: (state) => ({
        localKnowledgeEnabled: state.localKnowledgeEnabled,
        localKnowledgeEnabledPerThread: normalizeThreadOverrides(
          state.localKnowledgeEnabledPerThread
        ),
      }),
    }
  )
)
