import { useCallback, useEffect, useMemo, useState } from 'react'
import { type ThreadMessage } from '@ax-studio/core'
import { Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useThreads } from '@/hooks/useThreads'
import { useServiceHub } from '@/hooks/useServiceHub'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { isPlatformTauri } from '@/lib/platform/utils'
import {
  buildWorkspaceChatsExportData,
  extractThreadMessageText,
  type WorkspaceChatExportFormat,
  workspaceChatsToAlpacaJson,
  workspaceChatsToCsv,
  workspaceChatsToJson,
  workspaceChatsToOpenAIJsonl,
} from '@/lib/workspace-chat-export'

interface WorkspaceChatsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const PAGE_SIZE = 10

type WorkspaceChatRow = {
  id: string
  threadId: string
  threadTitle: string
  sentBy: string
  workspace: string
  prompt: string
  response: string
  sentAt: number
  promptMessageId: string
  responseMessageId?: string
}

const EXPORT_CONFIG: Record<
  WorkspaceChatExportFormat,
  { label: string; extension: string; fileSuffix: string; mimeType: string }
> = {
  csv: {
    label: 'CSV',
    extension: 'csv',
    fileSuffix: 'csv',
    mimeType: 'text/csv;charset=utf-8',
  },
  json: {
    label: 'JSON',
    extension: 'json',
    fileSuffix: 'json',
    mimeType: 'application/json;charset=utf-8',
  },
  alpaca: {
    label: 'JSON (Alpaca)',
    extension: 'json',
    fileSuffix: 'alpaca',
    mimeType: 'application/json;charset=utf-8',
  },
  'openai-jsonl': {
    label: 'JSONL (OpenAI)',
    extension: 'jsonl',
    fileSuffix: 'openai',
    mimeType: 'application/x-ndjson;charset=utf-8',
  },
}

const toSafeFileName = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'workspace'

const toMilliseconds = (timestamp: number): number =>
  timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp

const formatSentAt = (timestamp: number): string =>
  new Date(toMilliseconds(timestamp)).toLocaleString()

const downloadTextFile = (
  content: string,
  filename: string,
  mimeType: string
): void => {
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

const resolveWorkspaceName = (thread: Thread): string =>
  thread.metadata?.project?.name || 'General'

const buildWorkspaceChatRows = (
  allThreads: Thread[],
  messagesByThreadId: Record<string, ThreadMessage[]>
): WorkspaceChatRow[] => {
  const rows: WorkspaceChatRow[] = []

  allThreads.forEach((thread) => {
    const sortedMessages = (messagesByThreadId[thread.id] ?? [])
      .slice()
      .sort((a, b) => (a.created_at || 0) - (b.created_at || 0))

    for (let index = 0; index < sortedMessages.length; index += 1) {
      const message = sortedMessages[index]
      if (message.role !== 'user') continue

      let responseMessage: ThreadMessage | undefined
      for (
        let responseIndex = index + 1;
        responseIndex < sortedMessages.length;
        responseIndex += 1
      ) {
        const candidate = sortedMessages[responseIndex]
        if (candidate.role === 'user') break
        if (candidate.role === 'assistant') {
          responseMessage = candidate
          break
        }
      }

      rows.push({
        id: message.id,
        threadId: thread.id,
        threadTitle: thread.title,
        workspace: resolveWorkspaceName(thread),
        sentBy: message.role,
        prompt: extractThreadMessageText(message),
        response: responseMessage ? extractThreadMessageText(responseMessage) : '',
        sentAt: message.created_at || 0,
        promptMessageId: message.id,
        responseMessageId: responseMessage?.id,
      })
    }
  })

  return rows.sort((a, b) => b.sentAt - a.sentAt)
}

export default function WorkspaceChatsDialog({
  open,
  onOpenChange,
}: WorkspaceChatsDialogProps) {
  const { t } = useTranslation()
  const serviceHub = useServiceHub()
  const setThreads = useThreads((state) => state.setThreads)

  const [loading, setLoading] = useState(false)
  const [dialogThreads, setDialogThreads] = useState<Thread[]>([])
  const [messagesByThreadId, setMessagesByThreadId] = useState<
    Record<string, ThreadMessage[]>
  >({})
  const [selectedRow, setSelectedRow] = useState<WorkspaceChatRow | null>(null)
  const [currentPage, setCurrentPage] = useState(1)

  const allThreads = useMemo(
    () =>
      dialogThreads
        .filter((thread) => thread.id !== TEMPORARY_CHAT_ID)
        .sort((a, b) => (b.updated || 0) - (a.updated || 0)),
    [dialogThreads]
  )

  const rows = useMemo(
    () => buildWorkspaceChatRows(allThreads, messagesByThreadId),
    [allThreads, messagesByThreadId]
  )

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const pagedRows = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return rows.slice(start, start + PAGE_SIZE)
  }, [rows, currentPage])

  useEffect(() => {
    if (!open) return
    setCurrentPage(1)
  }, [open])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  const fetchMessagesMap = useCallback(async (threadsToLoad: Thread[]) => {
    if (threadsToLoad.length === 0) {
      setMessagesByThreadId({})
      return {}
    }

    const entries = await Promise.all(
      threadsToLoad.map(async (thread) => [
        thread.id,
        await serviceHub.messages().fetchMessages(thread.id),
      ] as const)
    )
    return Object.fromEntries(entries)
  }, [serviceHub])

  const loadWorkspaceChats = useCallback(async () => {
    if (!open) return

    setLoading(true)
    try {
      const fetchedThreads = await serviceHub.threads().fetchThreads()
      setDialogThreads(fetchedThreads)
      const nextMessages = await fetchMessagesMap(fetchedThreads)
      setMessagesByThreadId(nextMessages)
    } catch (error) {
      console.error('Failed to load workspace chats:', error)
      toast.error(t('common:error'))
    } finally {
      setLoading(false)
    }
  }, [fetchMessagesMap, open, serviceHub, t])

  useEffect(() => {
    void loadWorkspaceChats()
  }, [loadWorkspaceChats])

  const handleDeleteRow = async (row: WorkspaceChatRow) => {
    try {
      await serviceHub.messages().deleteMessage(row.threadId, row.promptMessageId)
      if (row.responseMessageId) {
        await serviceHub.messages().deleteMessage(row.threadId, row.responseMessageId)
      }
      await loadWorkspaceChats()
      toast.success(t('projects.workspaceChatsChatDeleted'))
    } catch (error) {
      console.error('Failed to delete workspace chat row:', error)
      toast.error(t('projects.workspaceChatsDeleteFailed'))
    }
  }

  const handleClearChats = async () => {
    try {
      await Promise.all(
        allThreads.map(async (thread) => {
          await serviceHub.threads().deleteThread(thread.id)
        })
      )
      setDialogThreads([])
      setMessagesByThreadId({})
      setThreads([])
      setSelectedRow(null)
      setCurrentPage(1)
      toast.success(t('projects.workspaceChatsCleared'))
    } catch (error) {
      console.error('Failed to clear workspace chats:', error)
      toast.error(t('projects.workspaceChatsClearFailed'))
    }
  }

  const handleExportWorkspaceChats = async (format: WorkspaceChatExportFormat) => {
    if (allThreads.length === 0) {
      toast.warning(t('projects.noWorkspaceChats'))
      return
    }

    try {
      const exportMessagesByThreadId =
        Object.keys(messagesByThreadId).length > 0
          ? messagesByThreadId
          : await fetchMessagesMap(allThreads)

      const exportThreads = allThreads.map((thread) => ({
        ...thread,
        title: `[${resolveWorkspaceName(thread)}] ${thread.title}`,
      }))
      const exportData = buildWorkspaceChatsExportData(
        {
          id: 'all-workspaces',
          name: 'All Workspaces',
          updated_at: Date.now(),
        },
        exportThreads,
        exportMessagesByThreadId
      )

      let fileContent = ''
      if (format === 'csv') {
        fileContent = workspaceChatsToCsv(exportData)
      } else if (format === 'alpaca') {
        fileContent = workspaceChatsToAlpacaJson(exportData)
      } else if (format === 'openai-jsonl') {
        fileContent = workspaceChatsToOpenAIJsonl(exportData)
      } else {
        fileContent = workspaceChatsToJson(exportData)
      }

      const config = EXPORT_CONFIG[format]
      const dateStamp = new Date().toISOString().slice(0, 10)
      const fileName = `${toSafeFileName(
        t('projects.workspaceChats')
      )}-${dateStamp}-${config.fileSuffix}.${config.extension}`

      if (isPlatformTauri()) {
        const savePath = await serviceHub.dialog().save({
          defaultPath: fileName,
          filters: [
            {
              name: config.label,
              extensions: [config.extension],
            },
          ],
        })
        if (!savePath) return

        await serviceHub.core().invoke('write_text_file', {
          path: savePath,
          content: fileContent,
        })
      } else {
        downloadTextFile(fileContent, fileName, config.mimeType)
      }

      toast.success(
        t('projects.exportSuccess', {
          projectName: t('projects.workspaceChats'),
          format: config.label,
        })
      )
    } catch (error) {
      console.error('Failed to export workspace chats:', error)
      toast.error(
        t('projects.exportFailed', { projectName: t('projects.workspaceChats') })
      )
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="sm:max-w-6xl p-0 gap-0 max-h-[90vh] flex flex-col"
          showCloseButton={false}
          aria-describedby={undefined}
        >
          <DialogHeader className="p-4 border-b shrink-0">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <DialogTitle>{t('projects.workspaceChats')}</DialogTitle>
                <DialogDescription>
                  {t('projects.workspaceChatsDescription')}
                </DialogDescription>
              </div>
              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" disabled={allThreads.length === 0}>
                      {t('projects.exportChats')}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => handleExportWorkspaceChats('csv')}>
                      {t('projects.exportAsCsv')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleExportWorkspaceChats('json')}>
                      {t('projects.exportAsJson')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleExportWorkspaceChats('alpaca')}>
                      {t('projects.exportAsAlpacaJson')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleExportWorkspaceChats('openai-jsonl')}>
                      {t('projects.exportAsOpenAIJsonl')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={allThreads.length === 0}
                  onClick={handleClearChats}
                >
                  {t('projects.clearChats')}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onOpenChange(false)}
                >
                  <X className="size-4" />
                  <span className="sr-only">{t('common:close')}</span>
                </Button>
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 min-h-0 p-4 overflow-y-auto space-y-3">
            {loading && (
              <div className="text-sm text-muted-foreground">{t('common:loading')}</div>
            )}

            {!loading && rows.length === 0 && (
              <div className="text-sm text-muted-foreground">
                {t('projects.noWorkspaceChats')}
              </div>
            )}

            {!loading &&
              pagedRows.map((row) => (
                <div
                  key={row.id}
                  className="rounded-lg border p-3 space-y-2 bg-card"
                >
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                    <div>
                      <p className="text-muted-foreground">{t('projects.logId')}</p>
                      <p className="font-mono truncate">{row.id}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t('projects.sentBy')}</p>
                      <p className="capitalize">{row.sentBy}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t('projects.workspace')}</p>
                      <p className="truncate">{row.workspace}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">{t('projects.sentAt')}</p>
                      <p>{formatSentAt(row.sentAt)}</p>
                    </div>
                  </div>

                  <button
                    className="w-full text-left rounded-md border p-2 hover:bg-secondary/40"
                    onClick={() => setSelectedRow(row)}
                  >
                    <p className="text-xs text-muted-foreground">{t('projects.prompt')}</p>
                    <p className="text-sm truncate">{row.prompt || '-'}</p>
                    <p className="text-xs text-muted-foreground mt-2">{t('projects.response')}</p>
                    <p className="text-sm truncate">{row.response || '-'}</p>
                  </button>

                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeleteRow(row)}
                    >
                      <Trash2 className="size-4" />
                      <span>{t('common:delete')}</span>
                    </Button>
                  </div>
                </div>
              ))}

            {!loading && rows.length > 0 && (
              <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-muted-foreground">
                  {Math.min((currentPage - 1) * PAGE_SIZE + 1, rows.length)}-
                  {Math.min(currentPage * PAGE_SIZE, rows.length)} / {rows.length}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  >
                    {t('common:back')}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {currentPage} / {totalPages}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={currentPage >= totalPages}
                    onClick={() =>
                      setCurrentPage((page) => Math.min(totalPages, page + 1))
                    }
                  >
                    {t('common:next')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={selectedRow !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setSelectedRow(null)
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{selectedRow?.threadTitle || t('projects.workspaceChats')}</DialogTitle>
            <DialogDescription>
              {selectedRow?.workspace} •{' '}
              {selectedRow ? formatSentAt(selectedRow.sentAt) : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t('projects.prompt')}</p>
              <div className="rounded-md border p-3 text-sm whitespace-pre-wrap break-words">
                {selectedRow?.prompt || '-'}
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">{t('projects.response')}</p>
              <div className="rounded-md border p-3 text-sm whitespace-pre-wrap break-words">
                {selectedRow?.response || '-'}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
