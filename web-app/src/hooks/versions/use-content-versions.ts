import { create } from 'zustand'

export interface ContentVersion {
  before: string
  after: string
  summary: string
  timestamp: number
  status: 'pending' | 'accepted' | 'rejected'
}

interface VersionState {
  /** Version data keyed by message ID */
  versionsByMessage: Record<string, ContentVersion>
  /** Track a change for review */
  addVersion: (messageId: string, version: Omit<ContentVersion, 'status' | 'timestamp'>) => void
  /** Accept the proposed change */
  acceptChange: (messageId: string) => void
  /** Reject the proposed change (revert to original) */
  rejectChange: (messageId: string) => void
  /** Get version data for a message */
  getVersion: (messageId: string) => ContentVersion | undefined
}

export const useContentVersions = create<VersionState>((set, get) => ({
  versionsByMessage: {},

  addVersion: (messageId, version) =>
    set((state) => ({
      versionsByMessage: {
        ...state.versionsByMessage,
        [messageId]: {
          ...version,
          status: 'pending',
          timestamp: Date.now(),
        },
      },
    })),

  acceptChange: (messageId) =>
    set((state) => {
      const existing = state.versionsByMessage[messageId]
      if (!existing) return state
      return {
        versionsByMessage: {
          ...state.versionsByMessage,
          [messageId]: { ...existing, status: 'accepted' },
        },
      }
    }),

  rejectChange: (messageId) =>
    set((state) => {
      const existing = state.versionsByMessage[messageId]
      if (!existing) return state
      return {
        versionsByMessage: {
          ...state.versionsByMessage,
          [messageId]: { ...existing, status: 'rejected' },
        },
      }
    }),

  getVersion: (messageId) => get().versionsByMessage[messageId],
}))
