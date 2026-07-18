import { create } from 'zustand'

/**
 * Artifact panel UI state, keyed by threadId so Split View panes (each with
 * their own threadId) can have independent panels. Session-only: no persist
 * middleware, state resets on reload.
 */

export type ArtifactPanelEntry = {
  open: boolean
  activeArtifactId?: string
}

type ArtifactPanelStore = {
  panels: Record<string, ArtifactPanelEntry>
  openPanel: (threadId: string, artifactId?: string) => void
  closePanel: (threadId: string) => void
  setActive: (threadId: string, artifactId: string) => void
}

export const useArtifactPanel = create<ArtifactPanelStore>((set) => ({
  panels: {},

  openPanel: (threadId, artifactId) =>
    set((state) => ({
      panels: {
        ...state.panels,
        [threadId]: {
          open: true,
          activeArtifactId:
            artifactId ?? state.panels[threadId]?.activeArtifactId,
        },
      },
    })),

  closePanel: (threadId) =>
    set((state) => {
      const existing = state.panels[threadId]
      if (!existing) return state
      return {
        panels: {
          ...state.panels,
          // Keep the entry (and its activeArtifactId) so reopening restores
          // the last-viewed artifact within the session.
          [threadId]: { ...existing, open: false },
        },
      }
    }),

  setActive: (threadId, artifactId) =>
    set((state) => ({
      panels: {
        ...state.panels,
        [threadId]: {
          open: state.panels[threadId]?.open ?? true,
          activeArtifactId: artifactId,
        },
      },
    })),
}))
