import { create } from 'zustand'

export interface ResearchSource {
  url: string
  title: string
  snippet: string
  score?: number
}

export interface ResearchStep {
  type: 'planning' | 'searching' | 'scraping' | 'summarising' | 'writing' | 'done' | 'error'
  message?: string
  query?: string
  url?: string
  title?: string
  timestamp: number
}

export interface ResearchEntry {
  status: 'running' | 'done' | 'error' | 'cancelled'
  query: string
  depth: 1 | 2 | 3
  steps: ResearchStep[]
  sources: ResearchSource[]
  reportMarkdown: string
  error?: string
}

interface ResearchPanelState {
  dataByThread: Record<string, ResearchEntry>
  openResearch: (threadId: string, query: string, depth: 1 | 2 | 3) => void
  updateResearch: (threadId: string, updater: (prev: ResearchEntry) => ResearchEntry) => void
  clearResearch: (threadId: string) => void
  getPinned: (threadId: string) => ResearchEntry | null
}

export const useResearchPanel = create<ResearchPanelState>((set, get) => ({
  dataByThread: {},

  openResearch: (threadId, query, depth) =>
    set((state) => ({
      dataByThread: {
        ...state.dataByThread,
        [threadId]: {
          status: 'running',
          query,
          depth,
          steps: [],
          sources: [],
          reportMarkdown: '',
        },
      },
    })),

  updateResearch: (threadId, updater) =>
    set((state) => {
      const prev = state.dataByThread[threadId]
      if (!prev) return {}
      return {
        dataByThread: {
          ...state.dataByThread,
          [threadId]: updater(prev),
        },
      }
    }),

  clearResearch: (threadId) =>
    set((state) => {
      const next = { ...state.dataByThread }
      delete next[threadId]
      return { dataByThread: next }
    }),

  getPinned: (threadId) => get().dataByThread[threadId] ?? null,
}))
