/**
 * Tauri App Service - Desktop implementation
 */

import { invoke } from '@tauri-apps/api/core'
import { AppConfiguration } from '@ax-studio/core'
import type { LogEntry } from './types'
import { DefaultAppService } from './default'

export class TauriAppService extends DefaultAppService {
  private resetInProgress = false

  async factoryReset(): Promise<void> {
    if (this.resetInProgress) {
      throw new Error('Factory reset already in progress')
    }
    this.resetInProgress = true
    try {
      const { EngineManager } = await import('@ax-studio/core')
      for (const [, engine] of EngineManager.instance().engines) {
        const activeModels = await engine.getLoadedModels()
        if (activeModels) {
          const unloadTasks = activeModels.map(async (model: string) => {
            try {
              await engine.unload(model)
            } catch (error) {
              console.error(`Failed to unload model during reset`, error)
            }
          })
          await Promise.all(unloadTasks)
        }
      }
      await invoke('factory_reset')
      window.localStorage.clear()
    } finally {
      this.resetInProgress = false
    }
  }

  async readLogs(): Promise<LogEntry[]> {
    const logData: string = (await invoke('read_logs')) ?? ''
    return logData.split('\n').map(this.parseLogLine)
  }

  async getAppDataFolder(): Promise<string | undefined> {
    try {
      const appConfiguration: AppConfiguration | undefined =
        await window.core?.api?.getAppConfigurations()

      return appConfiguration?.data_folder
    } catch (error) {
      console.error('Failed to get Ax-Studio data folder:', error)
      return undefined
    }
  }

  async relocateAppDataFolder(path: string): Promise<void> {
    // Previously used optional chaining — when `window.core.api` wasn't
    // available (service-hub not ready yet, wrong platform) this resolved
    // to `undefined` and `await undefined` silently succeeded, leaving the
    // user thinking the data folder was moved. Throw instead so the UI can
    // show a real error and the user can retry.
    const api = window.core?.api
    if (!api) throw new Error('Core API not available')
    await api.changeAppDataFolder({ newDataFolder: path })
  }

  parseLogLine(line: string): LogEntry {
    const regex = /^\[(.*?)\]\[(.*?)\]\[(.*?)\]\[(.*?)\]\s(.*)$/
    const match = line.match(regex)

    if (!match)
      return {
        timestamp: Date.now(),
        level: 'info' as 'info' | 'warn' | 'error' | 'debug',
        target: 'info',
        message: line ?? '',
      } as LogEntry

    const [, date, time, target, levelRaw, message] = match

    const level = levelRaw.toLowerCase() as 'info' | 'warn' | 'error' | 'debug'

    return {
      timestamp: new Date(`${date} ${time}`).getTime(),
      level,
      target,
      message,
    }
  }

  async getServerStatus(): Promise<boolean> {
    return await invoke<boolean>('get_server_status')
  }

  async readYaml<T = unknown>(path: string): Promise<T> {
    return await invoke<T>('read_yaml', { path })
  }
}
