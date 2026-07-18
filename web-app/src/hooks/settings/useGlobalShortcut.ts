import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { DEFAULT_QUICK_LAUNCH_SHORTCUT } from '@/services/global-shortcut/types'

type GlobalShortcutState = {
  /** Persisted accelerator for the global wake hotkey (Tauri format). */
  quickLaunchShortcut: string
  setQuickLaunchShortcut: (value: string) => void
}

export const useGlobalShortcut = create<GlobalShortcutState>()(
  persist(
    (set) => ({
      quickLaunchShortcut: DEFAULT_QUICK_LAUNCH_SHORTCUT,
      setQuickLaunchShortcut: (value) => set({ quickLaunchShortcut: value }),
    }),
    {
      name: localStorageKey.globalShortcut,
    }
  )
)
