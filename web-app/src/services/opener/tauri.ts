/**
 * Tauri Opener Service - Desktop implementation
 */

import { revealItemInDir, openUrl } from '@/lib/tauri-shim/plugin-opener'
import type { OpenerService } from './types'
import { assertSafeExternalUrl } from '@/lib/utils/safe-url'

export class TauriOpenerService implements OpenerService {
  async revealItemInDir(path: string): Promise<void> {
    try {
      await revealItemInDir(path)
    } catch (error) {
      console.error('Error revealing item in directory in Tauri:', error)
      throw error
    }
  }

  async openUrl(url: string): Promise<void> {
    let safeUrl: string
    try {
      safeUrl = assertSafeExternalUrl(url)
    } catch (error) {
      console.warn('[opener] Refusing to open unsafe URL:', url, error)
      return
    }
    await openUrl(safeUrl).catch(console.warn)
  }
}
