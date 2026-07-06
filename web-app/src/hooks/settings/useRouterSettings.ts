import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { createSafeJSONStorage } from '@/lib/storage/storage'

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

export const ROUTER_TIMEOUT_MIN_MS = 500
export const ROUTER_TIMEOUT_MAX_MS = 30000
export const ROUTER_TIMEOUT_DEFAULT_MS = 15000

function normalizeRouterTimeout(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined

  return Math.max(
    ROUTER_TIMEOUT_MIN_MS,
    Math.min(Math.trunc(value), ROUTER_TIMEOUT_MAX_MS)
  )
}

function normalizeThreadOverrides(
  value: unknown
): Record<string, boolean> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(
      (entry): entry is [string, boolean] =>
        entry[0] !== '' && typeof entry[1] === 'boolean'
    )
    .slice(-200)

  return Object.fromEntries(entries)
}

function sanitizePersistedRouterSettings(
  persisted: unknown,
  current: RouterSettingsState
): RouterSettingsState {
  if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) {
    return current
  }

  const state = persisted as Record<string, unknown>
  return {
    ...current,
    enabled:
      typeof state.enabled === 'boolean' ? state.enabled : current.enabled,
    routerModelId:
      typeof state.routerModelId === 'string' || state.routerModelId === null
        ? state.routerModelId
        : current.routerModelId,
    routerProviderId:
      typeof state.routerProviderId === 'string' ||
      state.routerProviderId === null
        ? state.routerProviderId
        : current.routerProviderId,
    timeout: normalizeRouterTimeout(state.timeout) ?? current.timeout,
    threadOverrides:
      normalizeThreadOverrides(state.threadOverrides) ??
      current.threadOverrides,
  }
}

export const useRouterSettings = create<RouterSettingsState>()(
  persist(
    (set, get) => ({
      enabled: false,
      routerModelId: null,
      routerProviderId: null,
      timeout: ROUTER_TIMEOUT_DEFAULT_MS,
      threadOverrides: {},

      setEnabled: (enabled) => set({ enabled }),

      setRouterModel: (modelId, providerId) =>
        set({ routerModelId: modelId, routerProviderId: providerId }),

      clearRouterModel: () =>
        set({ routerModelId: null, routerProviderId: null }),

      setTimeoutMs: (ms) =>
        set((state) => {
          if (!Number.isFinite(ms)) return state
          const timeout = Math.max(
            ROUTER_TIMEOUT_MIN_MS,
            Math.min(Math.trunc(ms), ROUTER_TIMEOUT_MAX_MS)
          )
          return { timeout }
        }),

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
          const updated = { ...state.threadOverrides }
          delete updated[threadId]
          return { threadOverrides: updated }
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
          timeout: ROUTER_TIMEOUT_DEFAULT_MS,
          threadOverrides: {},
        }),
    }),
    {
      name: localStorageKey.routerSettings,
      storage: createSafeJSONStorage(() => localStorage, 'useRouterSettings'),
      merge: (persisted, current) =>
        sanitizePersistedRouterSettings(persisted, current),
      partialize: (state) => ({
        enabled: state.enabled,
        routerModelId: state.routerModelId,
        routerProviderId: state.routerProviderId,
        timeout: state.timeout,
        threadOverrides: state.threadOverrides,
      }),
      version: 3,
      migrate: (persisted: unknown, version: number) => {
        const state =
          persisted && typeof persisted === 'object' && !Array.isArray(persisted)
            ? { ...(persisted as Record<string, unknown>) }
            : {}
        if (
          version < 3 &&
          (!state.timeout || state.timeout === 3000 || state.timeout === 8000)
        ) {
          state.timeout = ROUTER_TIMEOUT_DEFAULT_MS
        }
        return state
      },
    }
  )
)
