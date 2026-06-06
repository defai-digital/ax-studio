/**
 * File Registry — tracks which files have been indexed in which AkiDB collection.
 *
 * AkiDB has no built-in "list files" operation, so we maintain a lightweight
 * local index keyed by collection_id (e.g. "thread_{threadId}").
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

export type FileRegistryEntry = {
  file_id: string
  file_name: string
  file_path: string
  file_type?: string
  file_size?: number
  chunk_count: number
  collection_id: string
  created_at: string
}

type FileRegistryState = {
  /** collection_id → entries */
  files: Record<string, FileRegistryEntry[]>

  addFile: (collectionId: string, entry: FileRegistryEntry) => void
  removeFile: (collectionId: string, fileId: string) => void
  listFiles: (collectionId: string) => FileRegistryEntry[]
  getFile: (
    collectionId: string,
    fileId: string,
  ) => FileRegistryEntry | undefined
  clearCollection: (collectionId: string) => void
  hasFiles: (collectionId: string) => boolean
}

export const useFileRegistry = create<FileRegistryState>()(
  persist(
    (set, get) => ({
      files: {},

      addFile: (collectionId, entry) =>
        set((state) => {
          const existing = state.files[collectionId] ?? []
          // Prevent duplicates by path within the same collection
          if (existing.some((f) => f.file_path === entry.file_path)) {
            return state
          }
          return {
            files: {
              ...state.files,
              [collectionId]: [...existing, entry],
            },
          }
        }),

      removeFile: (collectionId, fileId) =>
        set((state) => {
          const existing = state.files[collectionId]
          if (!existing) return state
          const filtered = existing.filter((f) => f.file_id !== fileId)
          if (filtered.length === 0) {
            const { [collectionId]: _, ...rest } = state.files
            return { files: rest }
          }
          return {
            files: { ...state.files, [collectionId]: filtered },
          }
        }),

      listFiles: (collectionId) => get().files[collectionId] ?? [],

      getFile: (collectionId, fileId) =>
        (get().files[collectionId] ?? []).find((f) => f.file_id === fileId),

      clearCollection: (collectionId) =>
        set((state) => {
          const { [collectionId]: _, ...rest } = state.files
          return { files: rest }
        }),

      hasFiles: (collectionId) =>
        (get().files[collectionId] ?? []).length > 0,
    }),
    {
      name: localStorageKey.fileRegistryStore,
      storage: createJSONStorage(() => localStorage),
    },
  ),
)

/**
 * Build a deterministic collection ID from a thread or project identifier.
 */
export function threadCollectionId(threadId: string): string {
  return `thread_${threadId}`
}

export function projectCollectionId(projectId: string): string {
  return `project_${projectId}`
}
