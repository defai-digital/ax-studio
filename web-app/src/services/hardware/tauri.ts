/**
 * Tauri Hardware Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
import type { HardwareData, SystemUsage, DeviceList, HardwareService } from './types'

type LlamacppDeviceExtension = {
  getDevices: () => Promise<DeviceList[]>
}

/**
 * Lightweight runtime guard for the hardware plugin responses. The
 * previous implementation blindly cast `invoke(...)` results to the
 * frontend types — if the native plugin ever changes its response shape
 * the frontend silently operates on malformed data. This doesn't pull
 * in Zod (yet), but at least rejects obviously-wrong values (null,
 * string, missing top-level object).
 */
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasGetDevices = (value: unknown): value is LlamacppDeviceExtension =>
  isPlainObject(value) && typeof value.getDevices === 'function'

async function fetchPluginObject<T>(
  command: string,
  label: string
): Promise<T | null> {
  try {
    const raw = await invoke<unknown>(command)
    if (!isPlainObject(raw)) {
      console.warn(`[TauriHardwareService] ${label} returned unexpected shape:`, raw)
      return null
    }
    return raw as T
  } catch (error) {
    console.error(`[TauriHardwareService] ${label} failed:`, error)
    return null
  }
}

export class TauriHardwareService implements HardwareService {
  async getHardwareInfo(): Promise<HardwareData | null> {
    return fetchPluginObject<HardwareData>(
      'plugin:hardware|get_system_info',
      'get_system_info'
    )
  }

  async getSystemUsage(): Promise<SystemUsage | null> {
    return fetchPluginObject<SystemUsage>(
      'plugin:hardware|get_system_usage',
      'get_system_usage'
    )
  }

  async getLlamacppDevices(): Promise<DeviceList[]> {
    const ext = window.core?.extensionManager?.getByName(
      '@ax-studio/llamacpp-extension'
    )
    if (!hasGetDevices(ext)) return []

    try {
      return await ext.getDevices()
    } catch (e) {
      console.error('[TauriHardwareService] getLlamacppDevices failed:', e)
      return []
    }
  }

}
