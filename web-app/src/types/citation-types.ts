/**
 * Citation types for the "Show Your Sources" feature.
 * Used to track and display sources that informed AI responses.
 */

export interface CitationSource {
  /** Unique identifier (e.g., "src-1") */
  id: string
  /** Where the source came from */
  type: 'web' | 'document' | 'knowledge-base'
  /** URL for web sources */
  url?: string
  /** Human-readable title */
  title: string
  /** Preview snippet of the source content */
  snippet: string
  /** Relevance score 0-1 (from search engine) */
  score?: number
  /** Original document name (for KB/document sources) */
  documentName?: string
  /** When this source was retrieved */
  retrievedAt: number
}

export interface CitationData {
  sources: CitationSource[]
  confidence: 'strong' | 'moderate' | 'uncertain'
}
