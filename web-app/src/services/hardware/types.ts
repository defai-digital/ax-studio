/**
 * Hardware Service Types
 *
 * The pure data contracts (CPU, GPU, OS, RAM, HardwareData, SystemUsage) are
 * owned by the service layer so lower layers do not import from a UI hook.
 * The useHardware hook re-exports them for its existing call sites.
 */

// Device list interface for llamacpp extension
export interface DeviceList {
  id: string
  name: string
  mem: number
  free: number
  activated: boolean
}

// Hardware data types
export interface CPU {
  arch: string
  core_count: number
  extensions: string[]
  name: string
  usage: number
  instructions?: string[]
}

export interface GPU {
  name: string
  total_memory: number
  vendor: string
  uuid: string
  driver_version: string
  activated?: boolean
  nvidia_info: {
    index: number
    compute_capability: string
  }
  vulkan_info: {
    index: number
    device_id: number
    device_type: string
    api_version: string
  }
}

export interface OS {
  name: string
  version: string
}

export interface RAM {
  available: number
  total: number
}

export interface HardwareData {
  cpu: CPU
  gpus: GPU[]
  os_type: string
  os_name: string
  total_memory: number
  os?: OS
  ram?: RAM
}

export interface SystemUsage {
  cpu: number
  used_memory: number
  total_memory: number
  gpus: {
    uuid: string
    used_memory: number
    total_memory: number
  }[]
}

export interface HardwareService {
  getHardwareInfo(): Promise<HardwareData | null>
  getSystemUsage(): Promise<SystemUsage | null>
  getLlamacppDevices(): Promise<DeviceList[]>
}
