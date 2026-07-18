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
  hydrate: (
    messageId: string,
    metadata: Record<string, unknown> | undefined
  ) => void
}

const citationConfidenceLevels = new Set(['strong', 'moderate', 'uncertain'])
const citationSourceTypes = new Set(['web', 'document', 'knowledge-base'])

function isCitationSource(value: unknown): value is CitationData['sources'][number] {
  if (!value || typeof value !== 'object') return false

  const source = value as Partial<CitationData['sources'][number]>
  return (
    typeof source.id === 'string' &&
    citationSourceTypes.has(String(source.type)) &&
    (source.url === undefined || typeof source.url === 'string') &&
    typeof source.title === 'string' &&
    typeof source.snippet === 'string' &&
    (source.score === undefined || typeof source.score === 'number') &&
    (source.documentName === undefined ||
      typeof source.documentName === 'string') &&
    typeof source.retrievedAt === 'number'
  )
}

function isCitationData(value: unknown): value is CitationData {
  if (!value || typeof value !== 'object') return false

  const data = value as Partial<CitationData>
  return (
    Array.isArray(data.sources) &&
    data.sources.every(isCitationSource) &&
    citationConfidenceLevels.has(String(data.confidence))
  )
}

function areCitationSourcesEqual(
  left: CitationData['sources'][number],
  right: CitationData['sources'][number]
) {
  return (
    left.id === right.id &&
    left.type === right.type &&
    left.url === right.url &&
    left.title === right.title &&
    left.snippet === right.snippet &&
    left.score === right.score &&
    left.documentName === right.documentName &&
    left.retrievedAt === right.retrievedAt
  )
}

function areCitationDataEqual(
  left: CitationData | undefined,
  right: CitationData
) {
  if (!left) return false
  if (left === right) return true
  if (left.confidence !== right.confidence) return false
  if (left.sources.length !== right.sources.length) return false
  return left.sources.every((source, index) =>
    areCitationSourcesEqual(source, right.sources[index])
  )
}

const getOwnCitation = (
  citations: Record<string, CitationData>,
  messageId: string
): CitationData | undefined =>
  Object.prototype.hasOwnProperty.call(citations, messageId)
    ? citations[messageId]
    : undefined

export const useCitations = create<CitationState>((set, get) => ({
  citationsByMessage: {},

  setCitations: (messageId, data) =>
    set((state) => {
      if (
        areCitationDataEqual(
          getOwnCitation(state.citationsByMessage, messageId),
          data
        )
      ) {
        return state
      }

      return {
        citationsByMessage: { ...state.citationsByMessage, [messageId]: data },
      }
    }),

  getCitations: (messageId) =>
    getOwnCitation(get().citationsByMessage, messageId),

  hydrate: (messageId, metadata) => {
    if (!isCitationData(metadata?.citationData)) return
    const nextCitationData = metadata.citationData
    set((state) => {
      if (
        areCitationDataEqual(
          getOwnCitation(state.citationsByMessage, messageId),
          nextCitationData
        )
      ) {
        return state
      }

      return {
        citationsByMessage: {
          ...state.citationsByMessage,
          [messageId]: nextCitationData,
        },
      }
    })
  },
}))
