import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createSafeJSONStorage } from '@/lib/storage/storage'

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

const DATA_MODES = new Set<DataMode>(['local-only', 'hybrid', 'cloud'])

function isDataMode(value: unknown): value is DataMode {
  return typeof value === 'string' && DATA_MODES.has(value as DataMode)
}

function sanitizePersistedGuardrails(
  persisted: unknown,
  current: GuardrailsState
): GuardrailsState {
  if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) {
    return current
  }

  const state = persisted as Record<string, unknown>
  return {
    ...current,
    dataMode: isDataMode(state.dataMode) ? state.dataMode : current.dataMode,
    allowWebSearch:
      typeof state.allowWebSearch === 'boolean'
        ? state.allowWebSearch
        : current.allowWebSearch,
    alwaysCiteSources:
      typeof state.alwaysCiteSources === 'boolean'
        ? state.alwaysCiteSources
        : current.alwaysCiteSources,
    flagLowConfidence:
      typeof state.flagLowConfidence === 'boolean'
        ? state.flagLowConfidence
        : current.flagLowConfidence,
    requireApprovalBeforeEdits:
      typeof state.requireApprovalBeforeEdits === 'boolean'
        ? state.requireApprovalBeforeEdits
        : current.requireApprovalBeforeEdits,
  }
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

      setDataMode: (dataMode) => {
        if (isDataMode(dataMode)) set({ dataMode })
      },
      setAllowWebSearch: (allowWebSearch) => {
        if (typeof allowWebSearch === 'boolean') set({ allowWebSearch })
      },
      setAlwaysCiteSources: (alwaysCiteSources) => {
        if (typeof alwaysCiteSources === 'boolean') set({ alwaysCiteSources })
      },
      setFlagLowConfidence: (flagLowConfidence) => {
        if (typeof flagLowConfidence === 'boolean') set({ flagLowConfidence })
      },
      setRequireApprovalBeforeEdits: (requireApprovalBeforeEdits) => {
        if (typeof requireApprovalBeforeEdits === 'boolean') {
          set({ requireApprovalBeforeEdits })
        }
      },
    }),
    {
      name: 'ax-guardrails',
      storage: createSafeJSONStorage(() => localStorage, 'useGuardrails'),
      merge: (persisted, current) =>
        sanitizePersistedGuardrails(persisted, current),
      partialize: (state) => ({
        dataMode: state.dataMode,
        allowWebSearch: state.allowWebSearch,
        alwaysCiteSources: state.alwaysCiteSources,
        flagLowConfidence: state.flagLowConfidence,
        requireApprovalBeforeEdits: state.requireApprovalBeforeEdits,
      }),
    }
  )
)
