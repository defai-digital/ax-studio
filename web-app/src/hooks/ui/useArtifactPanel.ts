import { create } from 'zustand'
import type { ArtifactType } from '@/lib/artifacts/harness'

export interface ArtifactEntry {
  type: ArtifactType
  source: string
  /** Incrementing counter so pinning the same artifact again forces a refresh */
  version: number
  timestamp: number
}

interface ArtifactPanelState {
  pinnedByThread: Record<string, ArtifactEntry>
  historyByThread: Record<string, ArtifactEntry[]>
  pinArtifact: (threadId: string, type: ArtifactType, source: string) => void
  clearArtifact: (threadId: string) => void
  getPinned: (threadId: string) => ArtifactEntry | null
  updateSource: (threadId: string, newSource: string) => void
  restoreVersion: (threadId: string, entry: ArtifactEntry) => void
}

const MAX_HISTORY = 20

export const useArtifactPanel = create<ArtifactPanelState>((set, get) => ({
  pinnedByThread: {},
  historyByThread: {},

  pinArtifact: (threadId, type, source) =>
    set((state) => {
      const prev = state.pinnedByThread[threadId]
      const newVersion = (prev?.version ?? 0) + 1
      const entry: ArtifactEntry = { type, source, version: newVersion, timestamp: Date.now() }
      const prevHistory = state.historyByThread[threadId] ?? []
      const newHistory = [entry, ...prevHistory].slice(0, MAX_HISTORY)
      return {
        pinnedByThread: { ...state.pinnedByThread, [threadId]: entry },
        historyByThread: { ...state.historyByThread, [threadId]: newHistory },
      }
    }),

  clearArtifact: (threadId) =>
    set((state) => {
      const next = { ...state.pinnedByThread }
      delete next[threadId]
      return { pinnedByThread: next }
    }),

  getPinned: (threadId) => get().pinnedByThread[threadId] ?? null,

  updateSource: (threadId, newSource) =>
    set((state) => {
      const prev = state.pinnedByThread[threadId]
      if (!prev) return {}
      const updated: ArtifactEntry = {
        ...prev,
        source: newSource,
        version: prev.version + 1,
        timestamp: Date.now(),
      }
      const prevHistory = state.historyByThread[threadId] ?? []
      const newHistory = [updated, ...prevHistory].slice(0, MAX_HISTORY)
      return {
        pinnedByThread: { ...state.pinnedByThread, [threadId]: updated },
        historyByThread: { ...state.historyByThread, [threadId]: newHistory },
      }
    }),

  restoreVersion: (threadId, entry) =>
    set((state) => {
      // Restore without pushing to history (avoids duplicates)
      return {
        pinnedByThread: { ...state.pinnedByThread, [threadId]: entry },
      }
    }),
}))
