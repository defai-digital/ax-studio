import { create } from 'zustand'
import { getServiceHub } from '@/hooks/useServiceHub'
import type { DeviceList } from '@/services/hardware/types'
import { useModelProvider } from '@/hooks/models/useModelProvider'

interface LlamacppDevicesStore {
  devices: (DeviceList & { activated: boolean })[]
  loading: boolean
  error: string | null

  // Actions
  fetchDevices: () => Promise<void>
  clearError: () => void
  setDevices: (devices: (DeviceList & { activated: boolean })[]) => void
  toggleDevice: (deviceId: string) => Promise<void>
}

let fetchDevicesRequestId = 0
let toggleDeviceQueue: Promise<void> = Promise.resolve()

export const useLlamacppDevices = create<LlamacppDevicesStore>((set, get) => ({
  devices: [],
  loading: false,
  error: null,

  fetchDevices: async () => {
    const requestId = ++fetchDevicesRequestId
    set({ loading: true, error: null })

    try {
      const devices = await getServiceHub().hardware().getLlamacppDevices()
      if (requestId !== fetchDevicesRequestId) return

      // Check current device setting from provider
      const { getProviderByName } = useModelProvider.getState()
      const llamacppProvider = getProviderByName('llamacpp')
      const currentDeviceSetting = llamacppProvider?.settings?.find(
        (s) => s.key === 'device'
      )?.controller_props?.value as string | undefined

      // Parse device setting — comma-separated activated device IDs
      const activatedDevices = currentDeviceSetting
        ? currentDeviceSetting
            .split(',')
            .map((d) => d.trim())
            .filter(Boolean)
        : []

      const devicesWithActivation = devices.map((device) => ({
        ...device,
        activated:
          // Empty device setting means all devices are activated (llama-server default)
          !currentDeviceSetting ||
          currentDeviceSetting === '' ||
          activatedDevices.includes(device.id),
      }))

      set({ devices: devicesWithActivation, loading: false })
    } catch (error) {
      if (requestId !== fetchDevicesRequestId) return

      const errorMessage =
        error instanceof Error ? error.message : 'Failed to fetch devices'
      set({ error: errorMessage, loading: false })
    }
  },

  clearError: () => set({ error: null }),

  setDevices: (devices) => set({ devices }),

  toggleDevice: (deviceId: string) => {
    const operation = toggleDeviceQueue.then(async () => {
      const { getProviderByName, updateProvider } = useModelProvider.getState()
      const llamacppProvider = getProviderByName('llamacpp')
      const target = get().devices.find((device) => device.id === deviceId)
      if (!llamacppProvider || !target) return

      const previousActivated = target.activated
      set((state) => ({
        devices: state.devices.map((device) =>
          device.id === deviceId
            ? { ...device, activated: !previousActivated }
            : device
        ),
      }))

      const currentDevices = get().devices
      const activatedDeviceIds = currentDevices
        .filter((device) => device.activated)
        .map((device) => device.id)
      const deviceString =
        activatedDeviceIds.length === currentDevices.length
          ? ''
          : activatedDeviceIds.join(',')
      const updatedSettings = llamacppProvider.settings.map((setting) =>
        setting.key === 'device'
          ? {
              ...setting,
              controller_props: {
                ...setting.controller_props,
                value: deviceString,
              },
            }
          : setting
      )

      try {
        await getServiceHub()
          .providers()
          .updateSettings('llamacpp', updatedSettings)
        updateProvider('llamacpp', { settings: updatedSettings })
      } catch (error) {
        console.error(
          '[useLlamacppDevices] Failed to persist device setting:',
          error
        )
        set((state) => ({
          devices: state.devices.map((device) =>
            device.id === deviceId
              ? { ...device, activated: previousActivated }
              : device
          ),
          error:
            error instanceof Error
              ? error.message
              : 'Failed to update device setting',
        }))
      }
    })
    toggleDeviceQueue = operation.catch(() => {})
    return operation
  },
}))
