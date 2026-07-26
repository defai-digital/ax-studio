// Download command handlers (Node port of
// src-tauri/src/core/downloads/commands.rs). The download-extension invokes
// these with `{ items, taskId, headers }` / `{ taskId }`; progress is emitted
// as `download-<taskId>` events via emitToAllWindows.
import { str } from './args.js'
import type { CommandHandler } from './registry.js'
import {
  downloadDestinationKeys,
  downloadFilesInternal,
  resolveDownloadDestinations,
} from '../downloads/core.js'
import { DownloadCancelToken, downloadManager } from '../downloads/manager.js'
import {
  validateDownloadRequest,
  validateDownloadTaskId,
  type DownloadItem,
  type ProxyConfig,
} from '../downloads/policy.js'

type Args = Record<string, unknown>

function parseItems(raw: unknown): DownloadItem[] {
  if (!Array.isArray(raw)) {
    throw new Error('download_files: missing items')
  }
  return raw.map((entry) => {
    const source = (entry !== null && typeof entry === 'object' ? entry : {}) as Args
    const item: DownloadItem = {
      url: typeof source.url === 'string' ? source.url : '',
      save_path:
        typeof source.save_path === 'string'
          ? source.save_path
          : typeof source.savePath === 'string'
            ? source.savePath
            : '',
    }
    if (source.proxy !== null && typeof source.proxy === 'object') {
      item.proxy = source.proxy as ProxyConfig
    }
    if (typeof source.sha256 === 'string') item.sha256 = source.sha256
    if (typeof source.size === 'number' && Number.isFinite(source.size) && source.size >= 0) {
      item.size = Math.floor(source.size)
    }
    if (typeof source.model_id === 'string') item.model_id = source.model_id
    return item
  })
}

function parseHeaders(raw: unknown): Record<string, string> {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(raw as Args)) {
    if (typeof value === 'string') headers[name] = value
  }
  return headers
}

export function createDownloadHandlers(): Record<string, CommandHandler> {
  return {
    download_files: async (args) => {
      const items = parseItems(args?.items)
      const taskId = str(args?.taskId) ?? str(args?.task_id) ?? ''
      const headers = parseHeaders(args?.headers)

      // Validate the entire untrusted IPC payload before allocating task
      // state or touching the network; this handler is the privilege boundary.
      validateDownloadRequest(items, taskId, headers)
      const destinationKeys = resolveDownloadDestinations(items).flatMap((target) =>
        downloadDestinationKeys(target)
      )

      const token = new DownloadCancelToken()
      const generation = downloadManager.registerTask(taskId, token, destinationKeys)
      try {
        // Resume is handled via .tmp/.url sidecar files.
        await downloadFilesInternal(items, headers, taskId, true, token)
      } finally {
        downloadManager.finishTask(taskId, generation)
      }
      // Partial-file cleanup is owned by downloadSingleFile. Never remove the
      // final destination here: it may be a previously verified model that
      // this cancelled generation never replaced.
    },

    cancel_download_task: (args) => {
      const taskId = str(args?.taskId) ?? str(args?.task_id) ?? ''
      validateDownloadTaskId(taskId)
      const token = downloadManager.getToken(taskId)
      if (token === undefined) {
        throw new Error(`No download task: ${taskId}`)
      }
      token.cancel()
      console.log(`[downloads] Cancelled download task: ${taskId}`)
    },
  }
}
