import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { createSafeJSONStorage } from '@/lib/storage/storage'

type AxBiLiveNavigationState = {
  enabled: boolean
  setEnabled: (value: boolean) => void
}

export const useAxBiLiveNavigation = create<AxBiLiveNavigationState>()(
  persist(
    (set) => ({
      enabled: true,
      setEnabled: (value) => set({ enabled: value }),
    }),
    {
      name: localStorageKey.settingAxBiLiveNavigation,
      storage: createSafeJSONStorage(
        () => localStorage,
        'useAxBiLiveNavigation'
      ),
    }
  )
)
