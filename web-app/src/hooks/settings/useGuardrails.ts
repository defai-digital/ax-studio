import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createSafeJSONStorage } from '@/lib/storage'

export type DataMode = 'local-only' | 'hybrid' | 'cloud'

export interface GuardrailsState {
  // Data rules
  dataMode: DataMode
  allowWebSearch: boolean

  // Content rules
  alwaysCiteSources: boolean
  flagLowConfidence: boolean
  requireApprovalBeforeEdits: boolean

  // Setters
  setDataMode: (mode: DataMode) => void
  setAllowWebSearch: (value: boolean) => void
  setAlwaysCiteSources: (value: boolean) => void
  setFlagLowConfidence: (value: boolean) => void
  setRequireApprovalBeforeEdits: (value: boolean) => void
}

export const useGuardrails = create<GuardrailsState>()(
  persist(
    (set) => ({
      // Defaults: privacy-friendly
      dataMode: 'local-only',
      allowWebSearch: true,
      alwaysCiteSources: true,
      flagLowConfidence: true,
      requireApprovalBeforeEdits: false,

      setDataMode: (dataMode) => set({ dataMode }),
      setAllowWebSearch: (allowWebSearch) => set({ allowWebSearch }),
      setAlwaysCiteSources: (alwaysCiteSources) => set({ alwaysCiteSources }),
      setFlagLowConfidence: (flagLowConfidence) => set({ flagLowConfidence }),
      setRequireApprovalBeforeEdits: (requireApprovalBeforeEdits) =>
        set({ requireApprovalBeforeEdits }),
    }),
    {
      name: 'ax-guardrails',
      storage: createSafeJSONStorage(() => localStorage, 'useGuardrails'),
    }
  )
)
