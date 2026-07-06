import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { createSafeJSONStorage } from '@/lib/storage/storage'

type AxBiLiveNavigationState = {
  enabled: boolean
  setEnabled: (value: boolean) => void
}

function sanitizePersistedAxBiLiveNavigation(
  persisted: unknown,
  current: AxBiLiveNavigationState
): AxBiLiveNavigationState {
  if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) {
    return current
  }

  const state = persisted as Record<string, unknown>
  return {
    ...current,
    enabled:
      typeof state.enabled === 'boolean' ? state.enabled : current.enabled,
  }
}

export const useAxBiLiveNavigation = create<AxBiLiveNavigationState>()(
  persist(
    (set) => ({
      enabled: true,
      setEnabled: (value) => {
        if (typeof value === 'boolean') set({ enabled: value })
      },
    }),
    {
      name: localStorageKey.settingAxBiLiveNavigation,
      storage: createSafeJSONStorage(
        () => localStorage,
        'useAxBiLiveNavigation'
      ),
      merge: (persisted, current) =>
        sanitizePersistedAxBiLiveNavigation(persisted, current),
      partialize: (state) => ({
        enabled: state.enabled,
      }),
    }
  )
)
