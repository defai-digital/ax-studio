// hardware plugin command handlers (Node port of tauri-plugin-hardware).
import type { CommandHandler } from './registry.js'
import { getSystemInfo, getSystemUsage } from '../hardware/index.js'

export function createHardwareHandlers(): Record<string, CommandHandler> {
  return {
    'plugin:hardware|get_system_info': () => getSystemInfo(),
    'plugin:hardware|get_system_usage': () => getSystemUsage(),
  }
}
