import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { createSafeJSONStorage } from '@/lib/storage/storage'
// Pure hardware data contracts are owned by the service layer; re-exported
// here so existing import sites keep working.
export type {
  CPU,
  GPU,
  OS,
  RAM,
  HardwareData,
  SystemUsage,
} from '@/services/hardware/types'
import type {
  CPU,
  GPU,
  OS,
  RAM,
  HardwareData,
  SystemUsage,
} from '@/services/hardware/types'

// Default values
const defaultHardwareData: HardwareData = {
  cpu: {
    arch: '',
    core_count: 0,
    extensions: [],
    name: '',
    usage: 0,
  },
  gpus: [],
  os_type: '',
  os_name: '',
  total_memory: 0,
}

const defaultSystemUsage: SystemUsage = {
  cpu: 0,
  used_memory: 0,
  total_memory: 0,
  gpus: [],
}

interface HardwareStore {
  // Hardware data
  hardwareData: HardwareData
  systemUsage: SystemUsage

  // Update functions
  setCPU: (cpu: CPU) => void
  setGPUs: (gpus: GPU[]) => void
  setOS: (os: OS) => void
  setRAM: (ram: RAM) => void

  // Update entire hardware data at once
  setHardwareData: (data: HardwareData) => void

  // Update individual GPU
  updateGPU: (index: number, gpu: GPU) => void

  // Update RAM available
  updateSystemUsage: (usage: SystemUsage) => void

  // GPU loading state
  gpuLoading: { [index: number]: boolean }
  setGpuLoading: (index: number, loading: boolean) => void

  // Polling control
  pollingPaused: boolean
  pausePolling: () => void
  resumePolling: () => void
}

export const useHardware = create<HardwareStore>()(
  persist(
    (set) => ({
      hardwareData: defaultHardwareData,
      systemUsage: defaultSystemUsage,
      gpuLoading: {},
      pollingPaused: false,
      setGpuLoading: (index, loading) =>
        set((state) => {
          // Guard against out-of-bounds / empty gpu list — otherwise
          // accessing `.uuid` on `undefined` throws a TypeError inside a
          // Zustand setter and breaks subsequent renders.
          const gpu = state.hardwareData.gpus[index]
          if (!gpu) return state
          return {
            gpuLoading: {
              ...state.gpuLoading,
              [gpu.uuid]: loading,
            },
          }
        }),
      pausePolling: () => set({ pollingPaused: true }),
      resumePolling: () => set({ pollingPaused: false }),

      setCPU: (cpu) =>
        set((state) => ({
          hardwareData: {
            ...state.hardwareData,
            cpu,
          },
        })),

      setGPUs: (gpus) =>
        set((state) => ({
          hardwareData: {
            ...state.hardwareData,
            gpus,
          },
        })),

      setOS: (os) =>
        set((state) => ({
          hardwareData: {
            ...state.hardwareData,
            os,
          },
        })),

      setRAM: (ram) =>
        set((state) => ({
          hardwareData: {
            ...state.hardwareData,
            ram,
          },
        })),

      setHardwareData: (data) =>
        set({
          hardwareData: {
            ...data,
            cpu: {
              ...data.cpu,
              // Cortex migration - ensure instructions data ready
              instructions: [],
            },
            ram: {
              available: 0,
              total: 0,
            },
            gpus: data.gpus.map((gpu) => ({
              ...gpu,
              activated: gpu.activated ?? false,
            })),
          },
        }),

      updateGPU: (index, gpu) =>
        set((state) => {
          const newGPUs = [...state.hardwareData.gpus]
          if (index >= 0 && index < newGPUs.length) {
            newGPUs[index] = gpu
          }
          return {
            hardwareData: {
              ...state.hardwareData,
              gpus: newGPUs,
            },
          }
        }),

      updateSystemUsage: (systemUsage) =>
        set(() => ({
          systemUsage,
        })),
    }),
    {
      name: localStorageKey.settingHardware,
      storage: createSafeJSONStorage(() => localStorage, 'useHardware'),
      partialize: (state) => ({
        hardwareData: state.hardwareData,
      }),
    }
  )
)
