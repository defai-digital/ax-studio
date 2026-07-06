import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { createSafeJSONStorage } from '@/lib/storage/storage'
import { normalizeSidebarWidth } from './use-sidebar-resize'

type LeftPanelStoreState = {
  open: boolean
  size: number
  width: string // Sidebar width in rem (e.g., "15rem")
  setLeftPanel: (value: boolean) => void
  setLeftPanelSize: (value: number) => void
  setLeftPanelWidth: (value: string) => void
}

const DEFAULT_OPEN = true
const DEFAULT_SIZE = 20
const DEFAULT_WIDTH = '15rem'

function sanitizeLeftPanelState(
  persisted: unknown,
  current: LeftPanelStoreState
): LeftPanelStoreState {
  if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) {
    return current
  }

  const state = persisted as Record<string, unknown>
  return {
    ...current,
    open: typeof state.open === 'boolean' ? state.open : current.open,
    size:
      typeof state.size === 'number' && Number.isFinite(state.size)
        ? Math.max(0, Math.min(state.size, 100))
        : current.size,
    width:
      typeof state.width === 'string'
        ? normalizeSidebarWidth(state.width, DEFAULT_WIDTH)
        : current.width,
  }
}

export const useLeftPanel = create<LeftPanelStoreState>()(
  persist(
    (set) => ({
      open: DEFAULT_OPEN,
      size: DEFAULT_SIZE, // Default size of 20%
      width: DEFAULT_WIDTH, // Default sidebar width
      setLeftPanel: (value) => {
        if (typeof value === 'boolean') set({ open: value })
      },
      setLeftPanelSize: (value) => {
        if (Number.isFinite(value)) {
          set({ size: Math.max(0, Math.min(value, 100)) })
        }
      },
      setLeftPanelWidth: (value) => {
        if (typeof value === 'string') {
          set({ width: normalizeSidebarWidth(value, DEFAULT_WIDTH) })
        }
      },
    }),
    {
      name: localStorageKey.LeftPanel,
      storage: createSafeJSONStorage(() => localStorage, 'useLeftPanel'),
      merge: (persisted, current) =>
        sanitizeLeftPanelState(persisted, current),
      partialize: (state) => ({
        open: state.open,
        size: state.size,
        width: state.width,
      }),
    }
  )
)
