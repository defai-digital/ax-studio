/**
 * Tauri Hardware Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
import type { HardwareData, SystemUsage, DeviceList } from './types'
import { DefaultHardwareService } from './default'

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

export class TauriHardwareService extends DefaultHardwareService {
  async getHardwareInfo(): Promise<HardwareData | null> {
    try {
      const raw = await invoke<unknown>('plugin:hardware|get_system_info')
      if (!isPlainObject(raw)) {
        console.warn('[TauriHardwareService] get_system_info returned unexpected shape:', raw)
        return null
      }
      return raw as HardwareData
    } catch (error) {
      console.error('[TauriHardwareService] get_system_info failed:', error)
      return null
    }
  }

  async getSystemUsage(): Promise<SystemUsage | null> {
    try {
      const raw = await invoke<unknown>('plugin:hardware|get_system_usage')
      if (!isPlainObject(raw)) {
        console.warn('[TauriHardwareService] get_system_usage returned unexpected shape:', raw)
        return null
      }
      return raw as SystemUsage
    } catch (error) {
      console.error('[TauriHardwareService] get_system_usage failed:', error)
      return null
    }
  }

  async getLlamacppDevices(): Promise<DeviceList[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ext = (window as any).core?.extensionManager?.getByName(
      '@ax-studio/llamacpp-extension'
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

  async setActiveGpus(_data: { gpus: number[] }): Promise<void> {
    // Intentionally no-op in Phase 7 UI.
    // Local GPU selection UI was removed from active product flows.
  }
}
