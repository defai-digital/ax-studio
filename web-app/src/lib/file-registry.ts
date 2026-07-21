/**
 * File Registry — tracks which files have been indexed in which AkiDB collection.
 *
 * AkiDB has no built-in "list files" operation, so we maintain a lightweight
 * local index keyed by collection_id (e.g. "thread_{threadId}").
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { createSafeJSONStorage } from '@/lib/storage/storage'
import { SHA256, enc } from 'crypto-js'

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

const MAX_COLLECTIONS = 200
const MAX_FILES_PER_COLLECTION = 500

/** Keep in sync with ax-fabric RecordBuilder.computeDocId(sourcePath). */
export function fabricDocumentId(sourcePath: string): string {
  return SHA256(sourcePath).toString(enc.Hex)
}

type FileRegistryState = {
  /** collection_id → entries */
  files: Record<string, FileRegistryEntry[]>

  addFile: (collectionId: string, entry: FileRegistryEntry) => void
  removeFile: (collectionId: string, fileId: string) => void
  listFiles: (collectionId: string) => FileRegistryEntry[]
  getFile: (
    collectionId: string,
    fileId: string
  ) => FileRegistryEntry | undefined
  clearCollection: (collectionId: string) => void
  hasFiles: (collectionId: string) => boolean
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function normalizeOptionalFileSize(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined
  }
  return value
}

function normalizeChunkCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined
  }
  return Math.trunc(value)
}

function normalizeFileRegistryEntry(
  collectionId: string,
  value: unknown
): FileRegistryEntry | undefined {
  if (!isPlainRecord(value)) return undefined

  const fileId = isNonEmptyString(value.file_id)
    ? value.file_id.trim()
    : undefined
  const fileName = isNonEmptyString(value.file_name)
    ? value.file_name.trim()
    : undefined
  const filePath = isNonEmptyString(value.file_path)
    ? value.file_path.trim()
    : undefined
  const createdAt = isNonEmptyString(value.created_at)
    ? value.created_at.trim()
    : undefined
  const chunkCount = normalizeChunkCount(value.chunk_count)

  if (!fileId || !fileName || !filePath || !createdAt || chunkCount == null) {
    return undefined
  }

  return {
    file_id: fileId,
    file_name: fileName,
    file_path: filePath,
    file_type: normalizeOptionalString(value.file_type),
    file_size: normalizeOptionalFileSize(value.file_size),
    chunk_count: chunkCount,
    collection_id: collectionId,
    created_at: createdAt,
  }
}

function normalizeFileRegistryFiles(
  value: unknown
): Record<string, FileRegistryEntry[]> {
  if (!isPlainRecord(value)) return {}

  const collections = new Map<string, FileRegistryEntry[]>()
  const collectionEntries = Object.entries(value)
    .map(([collectionId, entries]) => [collectionId.trim(), entries] as const)
    .filter(([collectionId]) => collectionId !== '')
    .slice(-MAX_COLLECTIONS)

  for (const [collectionId, rawEntries] of collectionEntries) {
    if (!Array.isArray(rawEntries)) continue

    const seenPaths = new Set<string>()
    const normalizedEntries: FileRegistryEntry[] = []
    for (const rawEntry of rawEntries) {
      const entry = normalizeFileRegistryEntry(collectionId, rawEntry)
      if (!entry || seenPaths.has(entry.file_path)) continue

      normalizedEntries.push(entry)
      seenPaths.add(entry.file_path)
      if (normalizedEntries.length >= MAX_FILES_PER_COLLECTION) break
    }

    if (normalizedEntries.length > 0) {
      collections.set(collectionId, normalizedEntries)
    }
  }

  return Object.fromEntries(collections)
}

function getOwnCollection(
  files: Record<string, FileRegistryEntry[]>,
  collectionId: string
): FileRegistryEntry[] | undefined {
  return Object.prototype.hasOwnProperty.call(files, collectionId)
    ? files[collectionId]
    : undefined
}

function sanitizePersistedFileRegistry(
  persisted: unknown,
  current: FileRegistryState
): FileRegistryState {
  if (!isPlainRecord(persisted)) return current

  return {
    ...current,
    files: normalizeFileRegistryFiles(persisted.files),
  }
}

function migratePersistedFileRegistry(persisted: unknown): unknown {
  if (!isPlainRecord(persisted) || !isPlainRecord(persisted.files)) {
    return persisted
  }

  return {
    ...persisted,
    files: Object.fromEntries(
      Object.entries(persisted.files).map(([collectionId, entries]) => [
        collectionId,
        Array.isArray(entries)
          ? entries.map((entry) => {
              if (!isPlainRecord(entry) || !isNonEmptyString(entry.file_path)) {
                return entry
              }
              const filePath = entry.file_path.trim()
              return { ...entry, file_id: fabricDocumentId(filePath) }
            })
          : entries,
      ])
    ),
  }
}

export const useFileRegistry = create<FileRegistryState>()(
  persist(
    (set, get) => ({
      files: {},

      addFile: (collectionId, entry) =>
        set((state) => {
          const normalizedCollectionId = collectionId.trim()
          if (normalizedCollectionId === '') return state

          const normalizedEntry = normalizeFileRegistryEntry(
            normalizedCollectionId,
            entry
          )
          if (!normalizedEntry) return state

          const existing =
            getOwnCollection(state.files, normalizedCollectionId) ?? []
          // Same path: update metadata in place. The file_id is deterministic
          // from the source path and must match AkiDB's doc_id.
          const existingIndex = existing.findIndex(
            (f) => f.file_path === normalizedEntry.file_path
          )
          if (existingIndex >= 0) {
            const previous = existing[existingIndex]
            const updated = [...existing]
            updated[existingIndex] = {
              ...previous,
              ...normalizedEntry,
              collection_id: normalizedCollectionId,
            }
            return {
              files: {
                ...state.files,
                [normalizedCollectionId]: updated,
              },
            }
          }
          return {
            files: {
              ...state.files,
              [normalizedCollectionId]: [...existing, normalizedEntry].slice(
                -MAX_FILES_PER_COLLECTION
              ),
            },
          }
        }),

      removeFile: (collectionId, fileId) =>
        set((state) => {
          const existing = getOwnCollection(state.files, collectionId)
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

      listFiles: (collectionId) =>
        getOwnCollection(get().files, collectionId) ?? [],

      getFile: (collectionId, fileId) =>
        (getOwnCollection(get().files, collectionId) ?? []).find(
          (f) => f.file_id === fileId
        ),

      clearCollection: (collectionId) =>
        set((state) => {
          const { [collectionId]: _, ...rest } = state.files
          return { files: rest }
        }),

      hasFiles: (collectionId) =>
        (getOwnCollection(get().files, collectionId) ?? []).length > 0,
    }),
    {
      name: localStorageKey.fileRegistryStore,
      storage: createSafeJSONStorage(() => localStorage, 'useFileRegistry'),
      merge: (persisted, current) =>
        sanitizePersistedFileRegistry(persisted, current),
      partialize: (state) => ({ files: normalizeFileRegistryFiles(state.files) }),
      migrate: (persistedState: unknown) =>
        migratePersistedFileRegistry(persistedState),
      version: 1,
    }
  )
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
