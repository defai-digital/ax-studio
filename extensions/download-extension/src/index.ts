import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { BaseExtension, events } from '@ax-studio/core'

export enum Settings {
  hfToken = 'hf-token',
}

interface DownloadItem {
  url: string
  save_path: string
  proxy?: Record<string, string | string[] | boolean>
  sha256?: string
  size?: number
  model_id?: string
}

type DownloadEvent = {
  transferred: number
  total: number
}

export default class AxStudioDownloadManager extends BaseExtension {
  hfToken?: string

  async onLoad() {
    this.registerSettings(SETTINGS)
    this.hfToken = await this.getSetting<string>(Settings.hfToken, undefined)
  }

  async onUnload() {}

  async downloadFile(
    url: string,
    savePath: string,
    taskId: string,
    proxyConfig: Record<string, string | string[] | boolean> | null = null,
    onProgress?: (transferred: number, total: number) => void
  ) {
    // Only include the proxy field when there is actually a proxy configured.
    // Sending an empty object {} causes Rust's serde to fail deserializing
    // Option<ProxyConfig> because ProxyConfig.url is a required field.
    const item: DownloadItem = { url, save_path: savePath }
    if (proxyConfig && Object.keys(proxyConfig).length > 0) {
      item.proxy = proxyConfig
    }
    return await this.downloadFiles([item], taskId, onProgress)
  }

  onSettingUpdate<T>(key: string, value: T): void {
    if (key === Settings.hfToken) {
      this.hfToken = value as string
    }
  }

  async downloadFiles(
    items: DownloadItem[],
    taskId: string,
    onProgress?: (transferred: number, total: number) => void
  ) {
    // relay tauri events to onProgress callback
    const unlisten = await listen<DownloadEvent>(
      `download-${taskId}`,
      (event) => {
        if (onProgress) {
          let payload = event.payload
          onProgress(payload.transferred, payload.total)
        }
      }
    )

    try {
      await invoke<void>('download_files', {
        items,
        taskId,
        headers: this._getHeaders(),
      })
    } catch (error) {
      console.error('Error downloading task', taskId, error)
      throw error
    } finally {
      unlisten()
    }
  }

  async cancelDownload(taskId: string) {
    try {
      await invoke<void>('cancel_download_task', { taskId })
    } catch (error) {
      console.error('Error cancelling download:', error)
      throw error
    }
  }

  _getHeaders() {
    return {
      ...(this.hfToken && { Authorization: `Bearer ${this.hfToken}` }),
    }
  }
}
