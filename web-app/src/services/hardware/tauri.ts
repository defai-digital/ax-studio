/**
 * Tauri Hardware Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
import type { HardwareData, SystemUsage, DeviceList } from './types'
import { DefaultHardwareService } from './default'

export class TauriHardwareService extends DefaultHardwareService {
  async getHardwareInfo(): Promise<HardwareData | null> {
    return invoke('plugin:hardware|get_system_info') as Promise<HardwareData>
  }

  async getSystemUsage(): Promise<SystemUsage | null> {
    return invoke('plugin:hardware|get_system_usage') as Promise<SystemUsage>
  }

  async getLlamacppDevices(): Promise<DeviceList[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ext = (window as any).core?.extensionManager?.getByName(
      '@ax-fabric/llamacpp-extension'
    )
    if (!ext) return []

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await (ext as any).getDevices()
    } catch (e) {
      console.error('[TauriHardwareService] getLlamacppDevices failed:', e)
      return []
    }
  }

  async setActiveGpus(data: { gpus: number[] }): Promise<void> {
    // TODO: llama.cpp extension should handle this
    console.log(data)
  }
}
