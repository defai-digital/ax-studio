/**
 * Tauri Core Service - Desktop implementation
 */

import { invoke, convertFileSrc } from '@/lib/tauri-shim/api-core'
import type { ExtensionManifest } from '@/lib/extension'
import type { InvokeArgs, CoreService } from './types'
import { withTauriFallback, withTauriFallbackSync } from '../tauri-guard'

export class TauriCoreService implements CoreService {
  async invoke<T = unknown>(command: string, args?: InvokeArgs): Promise<T> {
    try {
      return await invoke<T>(command, args)
    } catch (error) {
      console.error(`Error invoking Tauri command '${command}' in Tauri:`, error)
      throw error
    }
  }

  convertFileSrc(filePath: string, protocol?: string): string {
    return withTauriFallbackSync(
      () => convertFileSrc(filePath, protocol),
      'Error converting file src in Tauri:',
      filePath
    )
  }

  // Extension management - using invoke
  async getActiveExtensions(): Promise<ExtensionManifest[]> {
    return withTauriFallback(
      () => this.invoke<ExtensionManifest[]>('get_active_extensions'),
      'Error getting active extensions in Tauri:',
      () => []
    )
  }

  async installExtensions(): Promise<void> {
    try {
      return await this.invoke<void>('install_extensions')
    } catch (error) {
      console.error('Error installing extensions in Tauri:', error)
      throw error
    }
  }

  async installExtension(extensions: ExtensionManifest[]): Promise<ExtensionManifest[]> {
    return withTauriFallback(
      () => this.invoke<ExtensionManifest[]>('install_extension', { extensions }),
      'Error installing extension in Tauri:',
      () => []
    )
  }

  async uninstallExtension(extensions: string[], reload = true): Promise<boolean> {
    return withTauriFallback(
      () => this.invoke<boolean>('uninstall_extension', { extensions, reload }),
      'Error uninstalling extension in Tauri:',
      () => false
    )
  }
}
