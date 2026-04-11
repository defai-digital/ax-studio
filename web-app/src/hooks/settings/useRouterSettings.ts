import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'

interface RouterSettingsState {
  /** Global toggle */
  enabled: boolean
  /** Which model does the routing */
  routerModelId: string | null
  /** Provider of the router model */
  routerProviderId: string | null
  /** Classification timeout in ms */
  timeout: number
  /** Per-thread overrides: threadId -> enabled/disabled */
  threadOverrides: Record<string, boolean>

  setEnabled: (enabled: boolean) => void
  setRouterModel: (modelId: string, providerId: string) => void
  clearRouterModel: () => void
  setTimeoutMs: (ms: number) => void
  setThreadOverride: (threadId: string, enabled: boolean) => void
  clearThreadOverride: (threadId: string) => void
  /** Check if auto-routing is enabled for a given thread (global + thread override) */
  isAutoRouteEnabled: (threadId?: string) => boolean
  /** Remove overrides for threads that no longer exist */
  cleanupStaleOverrides: (activeThreadIds: Set<string>) => void
  resetToDefaults: () => void
}

const DEFAULT_TIMEOUT = 15000

export const useRouterSettings = create<RouterSettingsState>()(
  persist(
    (set, get) => ({
      enabled: false,
      routerModelId: null,
      routerProviderId: null,
      timeout: DEFAULT_TIMEOUT,
      threadOverrides: {},

      setEnabled: (enabled) => set({ enabled }),

      setRouterModel: (modelId, providerId) =>
        set({ routerModelId: modelId, routerProviderId: providerId }),

      clearRouterModel: () =>
        set({ routerModelId: null, routerProviderId: null }),

      setTimeoutMs: (ms) => set({ timeout: Math.max(500, Math.min(ms, 30000)) }),

      setThreadOverride: (threadId, enabled) =>
        set((state) => {
          const updated = { ...state.threadOverrides, [threadId]: enabled }
          // Cap at 200 entries to prevent unbounded growth
          const keys = Object.keys(updated)
          if (keys.length > 200) {
            const toRemove = keys.slice(0, keys.length - 200)
            for (const key of toRemove) delete updated[key]
          }
          return { threadOverrides: updated }
        }),

      clearThreadOverride: (threadId) =>
        set((state) => {
          const { [threadId]: _, ...rest } = state.threadOverrides
          return { threadOverrides: rest }
        }),

      isAutoRouteEnabled: (threadId?: string) => {
        const state = get()
        if (!state.enabled || !state.routerModelId || !state.routerProviderId) {
          return false
        }
        if (threadId && threadId in state.threadOverrides) {
          return state.threadOverrides[threadId]
        }
        return state.enabled
      },

      cleanupStaleOverrides: (activeThreadIds) =>
        set((state) => {
          const cleaned: Record<string, boolean> = {}
          for (const [id, val] of Object.entries(state.threadOverrides)) {
            if (activeThreadIds.has(id)) cleaned[id] = val
          }
          return { threadOverrides: cleaned }
        }),

      resetToDefaults: () =>
        set({
          enabled: false,
          routerModelId: null,
          routerProviderId: null,
          timeout: DEFAULT_TIMEOUT,
          threadOverrides: {},
        }),
    }),
    {
      name: localStorageKey.routerSettings,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        enabled: state.enabled,
        routerModelId: state.routerModelId,
        routerProviderId: state.routerProviderId,
        timeout: state.timeout,
        threadOverrides: state.threadOverrides,
      }),
      version: 3,
      migrate: (persisted: unknown, version: number) => {
        const state = { ...(persisted as Record<string, unknown>) }
        if (version < 3 && (!state.timeout || state.timeout === 3000 || state.timeout === 8000)) {
          state.timeout = 15000
        }
        return state
      },
    }
  )
)
