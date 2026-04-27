/**
 * Tauri Opener Service - Desktop implementation
 */

import { revealItemInDir } from '@tauri-apps/plugin-opener'
import type { OpenerService } from './types'

export class TauriOpenerService implements OpenerService {
  async revealItemInDir(path: string): Promise<void> {
    try {
      await revealItemInDir(path)
    } catch (error) {
      console.error('Error revealing item in directory in Tauri:', error)
      throw error
    }
  }
}
