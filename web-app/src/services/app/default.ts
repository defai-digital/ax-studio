/**
 * Default App Service - Generic implementation with minimal returns
 */

import type { AppService, LogEntry } from './types'

export class DefaultAppService implements AppService {
  async factoryReset(): Promise<void> {
    // No-op
  }

  async readLogs(): Promise<LogEntry[]> {
    return []
  }

  parseLogLine(line: string): LogEntry {
    return {
      timestamp: Date.now(),
      level: 'info',
      target: 'default',
      message: line ?? '',
    }
  }

  async getAppDataFolder(): Promise<string | undefined> {
    return undefined
  }

  async relocateAppDataFolder(_path: string): Promise<void> {
  }

  async getServerStatus(): Promise<boolean> {
    return false
  }

  async readYaml<T = unknown>(_path: string): Promise<T> {
    throw new Error('readYaml not implemented in default app service')
  }
}
