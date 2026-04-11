import { create } from 'zustand'
import type { CitationData } from '@/types/citation-types'

interface CitationState {
  /** Citation data keyed by message ID */
  citationsByMessage: Record<string, CitationData>
  /** Store citation data for a message */
  setCitations: (messageId: string, data: CitationData) => void
  /** Get citation data for a message (returns undefined if none) */
  getCitations: (messageId: string) => CitationData | undefined
  /** Hydrate citations from message metadata (called when messages load) */
  hydrate: (messageId: string, metadata: Record<string, unknown> | undefined) => void
}

export const useCitations = create<CitationState>((set, get) => ({
  citationsByMessage: {},

  setCitations: (messageId, data) =>
    set((state) => ({
      citationsByMessage: { ...state.citationsByMessage, [messageId]: data },
    })),

  getCitations: (messageId) => get().citationsByMessage[messageId],

  hydrate: (messageId, metadata) => {
    if (!metadata?.citationData) return
    const existing = get().citationsByMessage[messageId]
    if (existing) return // already hydrated
    set((state) => ({
      citationsByMessage: {
        ...state.citationsByMessage,
        [messageId]: metadata.citationData as CitationData,
      },
    }))
  },
}))
