/**
 * Tauri Opener Service - Desktop implementation
 */

import { revealItemInDir, openUrl } from '@tauri-apps/plugin-opener'
import type { OpenerService } from './types'
import { tryAxBiLiveNavigation } from '@/lib/ax-bi/live-navigation'

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
    if (await tryAxBiLiveNavigation(url)) {
      return
    }
    await openUrl(url).catch(console.warn)
  }
}
