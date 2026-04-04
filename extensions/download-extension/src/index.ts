import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { BaseExtension, events } from '@ax-studio/core'

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
  async onLoad() {
    this.registerSettings(SETTINGS)
  }

  async onUnload() {}

  /**
   * Sanitize a task ID so it is safe to use in Tauri event names.
   * Tauri 2 only allows alphanumeric, `-`, `/`, `:`, and `_` characters.
   * Dots and other characters in model IDs (e.g. "Qwen3.5-27B") would
   * cause listen() to throw "invalid args `event`".
   */
  private _sanitizeTaskId(taskId: string): string {
    return taskId.replace(/[^a-zA-Z0-9\-/_:]/g, '_')
  }

  async downloadFile(
    url: string,
    savePath: string,
    taskId: string,
    proxyConfig: Record<string, string | string[] | boolean> | null = null,
    requestHeaders?: Record<string, string>,
    onProgress?: (transferred: number, total: number) => void
  ) {
    // Only include the proxy field when there is actually a proxy configured.
    // Sending an empty object {} causes Rust's serde to fail deserializing
    // Option<ProxyConfig> because ProxyConfig.url is a required field.
    const item: DownloadItem = { url, save_path: savePath }
    if (proxyConfig && Object.keys(proxyConfig).length > 0) {
      item.proxy = proxyConfig
    }
    return await this.downloadFiles([item], taskId, requestHeaders, onProgress)
  }

  async downloadFiles(
    items: DownloadItem[],
    taskId: string,
    requestHeaders?: Record<string, string>,
    onProgress?: (transferred: number, total: number) => void
  ) {
    if (items.length === 0) {
      throw new Error('downloadFiles requires at least one item')
    }

    // Sanitize taskId for Tauri event name compatibility
    const safeTaskId = this._sanitizeTaskId(taskId)

    // relay tauri events to onProgress callback
    const unlisten = await listen<DownloadEvent>(
      `download-${safeTaskId}`,
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
        taskId: safeTaskId,
        headers: requestHeaders ?? {},
      })
    } catch (error) {
      console.error('Error downloading task', taskId, error)
      throw error
    } finally {
      // Give already-queued progress callbacks one turn to run before removing the listener.
      await Promise.resolve()
      unlisten()
    }
  }

  async cancelDownload(taskId: string) {
    const safeTaskId = this._sanitizeTaskId(taskId)
    try {
      await invoke<void>('cancel_download_task', { taskId: safeTaskId })
    } catch (error) {
      console.error('Error cancelling download:', error)
      throw error
    }
  }
}
