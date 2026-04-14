import { type ThreadMessage } from '@ax-studio/core'
import { toast } from 'sonner'
import { isPlatformTauri } from '@/lib/platform/utils'
import { getServiceHub } from '@/hooks/useServiceHub'
import {
  type WorkspaceChatExportFormat,
  buildWorkspaceChatsExportData,
  workspaceChatsToJson,
  workspaceChatsToCsv,
  workspaceChatsToAlpacaJson,
  workspaceChatsToOpenAIJsonl,
} from '@/lib/workspace-chat-export'

const EXPORT_CONFIG: Record<
  WorkspaceChatExportFormat,
  { label: string; extension: string; fileSuffix: string; mimeType: string }
> = {
  csv: { label: 'CSV', extension: 'csv', fileSuffix: 'csv', mimeType: 'text/csv;charset=utf-8' },
  json: { label: 'JSON', extension: 'json', fileSuffix: 'json', mimeType: 'application/json;charset=utf-8' },
  alpaca: { label: 'JSON (Alpaca)', extension: 'json', fileSuffix: 'alpaca', mimeType: 'application/json;charset=utf-8' },
  'openai-jsonl': { label: 'JSONL (OpenAI)', extension: 'jsonl', fileSuffix: 'openai', mimeType: 'application/x-ndjson;charset=utf-8' },
}

const toSafeFileName = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'chat'

const downloadTextFile = (content: string, filename: string, mimeType: string): void => {
  const blob = new Blob([content], { type: mimeType })
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(objectUrl)
}

/**
 * Export a single thread's chat in the given format.
 * Fetches messages from the service hub and triggers a file download.
 */
export async function exportThread(
  thread: { id: string; title: string; updated: number },
  format: WorkspaceChatExportFormat
): Promise<void> {
  const serviceHub = getServiceHub()
  if (!serviceHub) {
    toast.error('Export unavailable')
    return
  }

  try {
    const messages: ThreadMessage[] = await serviceHub.messages().fetchMessages(thread.id)
    if (!messages || messages.length === 0) {
      toast.warning('No messages to export')
      return
    }

    const exportData = buildWorkspaceChatsExportData(
      { id: 'export', name: 'Export', updated_at: Date.now() },
      [thread],
      { [thread.id]: messages }
    )

    let fileContent: string
    switch (format) {
      case 'csv':
        fileContent = workspaceChatsToCsv(exportData)
        break
      case 'alpaca':
        fileContent = workspaceChatsToAlpacaJson(exportData)
        break
      case 'openai-jsonl':
        fileContent = workspaceChatsToOpenAIJsonl(exportData)
        break
      default:
        fileContent = workspaceChatsToJson(exportData)
    }

    const config = EXPORT_CONFIG[format]
    const dateStamp = new Date().toISOString().slice(0, 10)
    const fileName = `${toSafeFileName(thread.title)}-${dateStamp}-${config.fileSuffix}.${config.extension}`

    if (isPlatformTauri()) {
      const savePath = await serviceHub.dialog().save({
        defaultPath: fileName,
        filters: [{ name: config.label, extensions: [config.extension] }],
      })
      if (!savePath) return

      await serviceHub.core().invoke('write_text_file', {
        path: savePath,
        content: fileContent,
      })
    } else {
      downloadTextFile(fileContent, fileName, config.mimeType)
    }

    toast.success(`Exported "${thread.title}" as ${config.label}`)
  } catch (error) {
    console.error('Failed to export thread:', error)
    toast.error('Failed to export chat')
  }
}

/**
 * Export ALL threads in the given format.
 */
export async function exportAllThreads(
  format: WorkspaceChatExportFormat
): Promise<void> {
  const serviceHub = getServiceHub()
  if (!serviceHub) {
    toast.error('Export unavailable')
    return
  }

  try {
    const threads = await serviceHub.threads().fetchThreads()
    if (!threads || threads.length === 0) {
      toast.warning('No chats to export')
      return
    }

    const messagesByThreadId: Record<string, ThreadMessage[]> = {}
    for (const thread of threads) {
      const threadId = typeof thread === 'object' && thread !== null
        ? (thread as { id: string }).id
        : ''
      if (threadId) {
        messagesByThreadId[threadId] = await serviceHub.messages().fetchMessages(threadId)
      }
    }

    const threadList = threads.map((t) => {
      const obj = t as { id: string; title: string; updated: number }
      return { id: obj.id, title: obj.title || 'Untitled', updated: obj.updated || 0 }
    })

    const exportData = buildWorkspaceChatsExportData(
      { id: 'all-chats', name: 'All Chats', updated_at: Date.now() },
      threadList,
      messagesByThreadId
    )

    let fileContent: string
    switch (format) {
      case 'csv':
        fileContent = workspaceChatsToCsv(exportData)
        break
      case 'alpaca':
        fileContent = workspaceChatsToAlpacaJson(exportData)
        break
      case 'openai-jsonl':
        fileContent = workspaceChatsToOpenAIJsonl(exportData)
        break
      default:
        fileContent = workspaceChatsToJson(exportData)
    }

    const config = EXPORT_CONFIG[format]
    const dateStamp = new Date().toISOString().slice(0, 10)
    const fileName = `all-chats-${dateStamp}-${config.fileSuffix}.${config.extension}`

    if (isPlatformTauri()) {
      const savePath = await serviceHub.dialog().save({
        defaultPath: fileName,
        filters: [{ name: config.label, extensions: [config.extension] }],
      })
      if (!savePath) return

      await serviceHub.core().invoke('write_text_file', {
        path: savePath,
        content: fileContent,
      })
    } else {
      downloadTextFile(fileContent, fileName, config.mimeType)
    }

    toast.success(`Exported ${threadList.length} chats as ${config.label}`)
  } catch (error) {
    console.error('Failed to export all threads:', error)
    toast.error('Failed to export chats')
  }
}
