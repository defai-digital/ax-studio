import { Download, Folder, ImagePlus, MessageCircle, MoreHorizontal, Pencil, Pin, PinOff, Trash2, X } from 'lucide-react'
import { exportThread } from '@/lib/thread-export'
import { useThreads } from '@/hooks/useThreads'
import { useMessages } from '@/hooks/useMessages'
import { useThreadManagement } from '@/hooks/useThreadManagement'
import { useCallback } from 'react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { useSidebar } from '@/components/ui/sidebar-context'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { memo, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { RenameThreadDialog, DeleteThreadDialog } from '@/containers/dialogs'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

function formatRelativeTime(timestamp: number): string {
  const now = Date.now() / 1000
  const diff = now - timestamp
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(timestamp * 1000).toLocaleDateString()
}

const ThreadItem = memo(
  ({
    thread,
    isMobile,
    currentProjectId,
    onTogglePin,
    isPinned,
  }: {
    thread: Thread
    isMobile: boolean
    currentProjectId?: string
    onTogglePin?: (threadId: string) => void
    isPinned?: boolean
  }) => {
    const deleteThread = useThreads((state) => state.deleteThread)
    const renameThread = useThreads((state) => state.renameThread)
    const updateThread = useThreads((state) => state.updateThread)
    const getFolderById = useThreadManagement().getFolderById
    const { folders } = useThreadManagement()
    const { t } = useTranslation()
    const [renameOpen, setRenameOpen] = useState(false)
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
    const [logoDialogOpen, setLogoDialogOpen] = useState(false)
    const [chatLogo, setChatLogo] = useState('')

    // Read messages from store only if already loaded (no fetching in sidebar)
    const messages = useMessages((state) => state.messages[thread.id])

    const lastUserMessageText = useMemo(() => {
      if (!messages || messages.length === 0) return undefined
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          const textContent = messages[i].content?.find((c) => c.type === 'text')
          return textContent?.text?.value
        }
      }
      return undefined
    }, [messages])

    const plainTitleForRename = useMemo(() => {
      return (thread.title || '').replace(/<span[^>]*>|<\/span>/g, '')
    }, [thread.title])

    const currentChatLogo = useMemo(() => {
      return typeof thread.metadata?.chatLogo === 'string'
        ? thread.metadata.chatLogo.trim()
        : ''
    }, [thread.metadata])

    const availableProjects = useMemo(() => {
      return folders
        .filter((f) => {
          if (f.id === currentProjectId) return false
          if (f.id === thread.metadata?.project?.id) return false
          return true
        })
        .sort((a, b) => b.updated_at - a.updated_at)
    }, [folders, currentProjectId, thread.metadata?.project?.id])

    const assignThreadToProject = useCallback((threadId: string, projectId: string) => {
      const project = getFolderById(projectId)
      if (project && updateThread) {
        const projectMetadata = {
          id: project.id,
          name: project.name,
          updated_at: project.updated_at,
          logo: project.logo,
          projectPrompt: project.projectPrompt ?? null,
        }

        updateThread(threadId, {
          metadata: {
            ...thread.metadata,
            project: projectMetadata,
          },
        })

        toast.success(`Thread assigned to "${project.name}" successfully`)
      }
    }, [getFolderById, updateThread, thread.metadata])

    const handleSaveChatLogo = useCallback(() => {
      const normalizedLogo = chatLogo.trim()
      updateThread(thread.id, {
        metadata: {
          ...thread.metadata,
          chatLogo: normalizedLogo || undefined,
        },
      })
      setLogoDialogOpen(false)
      toast.success(
        normalizedLogo
          ? t('common:chatLogoSaved', { defaultValue: 'Chat logo saved.' })
          : t('common:chatLogoRemoved', { defaultValue: 'Chat logo removed.' })
      )
    }, [chatLogo, updateThread, thread.id, thread.metadata, t])

    const handleChatLogoFileChange = useCallback((file?: File) => {
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        setChatLogo(String(reader.result || ''))
      }
      reader.onerror = () => {
        toast.error(t('error'))
      }
      reader.readAsDataURL(file)
    }, [t])

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
      <SidebarMenuItem>
        {currentProjectId ?
          <Link
            to="/threads/$threadId"
            params={{ threadId: thread.id }}
            className="flex items-start gap-3 p-4 rounded-xl border border-border/50 hover:border-border hover:bg-muted/20 transition-all block"
          >
            <MessageCircle className="size-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {currentChatLogo && (
                    <img
                      src={currentChatLogo}
                      alt={thread.title || t('common:newThread')}
                      className="size-4 rounded-sm object-cover shrink-0"
                      loading="lazy"
                    />
                  )}
                  <span
                    className="truncate"
                    style={{ fontSize: '14px', fontWeight: 500 }}
                  >
                    {thread.title || t('common:newThread')}
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {formatRelativeTime(thread.updated)}
                </span>
              </div>
              {lastUserMessageText && (
                <p className="text-[12px] text-muted-foreground mt-0.5 truncate pr-8">
                  {lastUserMessageText}
                </p>
              )}
            </div>
          </Link>
          :
          <SidebarMenuButton asChild>
            <Link to="/threads/$threadId" params={{ threadId: thread.id }}>
              {currentChatLogo && (
                <img
                  src={currentChatLogo}
                  alt={thread.title || t('common:newThread')}
                  className="size-4 rounded-sm object-cover"
                  loading="lazy"
                />
              )}
              <span>{thread.title || t('common:newThread')}</span>
            </Link>
          </SidebarMenuButton>
        }
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction
              showOnHover
              className={cn("hover:bg-sidebar-foreground/8", currentProjectId && 'mt-3.5 mr-2')}
            >
              <MoreHorizontal />
              <span className="sr-only">More</span>
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-48"
            side={isMobile ? 'bottom' : 'right'}
            align={isMobile ? 'end' : 'start'}
          >
            <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
              <Pencil className="size-4" />
              <span>{t('common:rename')}</span>
            </DropdownMenuItem>
            {onTogglePin && (
              <DropdownMenuItem onSelect={() => onTogglePin(thread.id)}>
                {isPinned ? (
                  <>
                    <PinOff className="size-4" />
                    <span>Unpin</span>
                  </>
                ) : (
                  <>
                    <Pin className="size-4" />
                    <span>Pin</span>
                  </>
                )}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={() => {
                setChatLogo(currentChatLogo)
                setLogoDialogOpen(true)
              }}
            >
              <ImagePlus className="size-4" />
              <span>
                {t('common:setChatLogo', { defaultValue: 'Set Chat Logo' })}
              </span>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2">
                <Folder className="size-4" />
                <span>{t('common:projects.addToProject')}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-60 min-w-44 overflow-y-auto">
                {availableProjects.length === 0 ? (
                  <DropdownMenuItem disabled>
                    <span className="text-muted-foreground">
                      {t('common:projects.noProjectsAvailable')}
                    </span>
                  </DropdownMenuItem>
                ) : (
                  availableProjects.map((folder) => (
                    <DropdownMenuItem
                      key={folder.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        assignThreadToProject(thread.id, folder.id)
                      }}
                    >
                      <Folder className="size-4" />
                      <span className="truncate max-w-[200px]">
                        {folder.name}
                      </span>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2">
                <Download className="size-4" />
                <span>Export Chat</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-36">
                <DropdownMenuItem onSelect={() => exportThread(thread, 'json')}>
                  <span>JSON</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportThread(thread, 'csv')}>
                  <span>CSV</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportThread(thread, 'alpaca')}>
                  <span>JSON (Alpaca)</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportThread(thread, 'openai-jsonl')}>
                  <span>JSONL (OpenAI)</span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {thread.metadata?.project && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    const projectName = thread.metadata?.project?.name
                    updateThread(thread.id, {
                      metadata: {
                        ...thread.metadata,
                        project: undefined,
                      },
                    })
                    toast.success(
                      `Thread removed from "${projectName}" successfully`
                    )
                  }}
                >
                  <X className="size-4" />
                  <span>Remove from project</span>
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                setDeleteConfirmOpen(true)
              }}
            >
              <Trash2 className="size-4" />
              <span>{t('common:delete')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <RenameThreadDialog
          thread={thread}
          plainTitleForRename={plainTitleForRename}
          onRename={renameThread}
          open={renameOpen}
          onOpenChange={setRenameOpen}
          withoutTrigger
        />
        
        <DeleteThreadDialog
          thread={thread}
          onDelete={deleteThread}
          open={deleteConfirmOpen}
          onOpenChange={setDeleteConfirmOpen}
          withoutTrigger
        />

        <Dialog open={logoDialogOpen} onOpenChange={setLogoDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {t('common:setChatLogo', { defaultValue: 'Set Chat Logo' })}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input
                value={chatLogo}
                onChange={(event) => setChatLogo(event.target.value)}
                placeholder={t('common:chatLogoPlaceholder', {
                  defaultValue: 'https://example.com/chat-logo.png',
                })}
              />
              <Input
                type="file"
                accept="image/*"
                onChange={(event) =>
                  handleChatLogoFileChange(event.target.files?.[0])
                }
              />
              {chatLogo.trim() && (
                <img
                  src={chatLogo.trim()}
                  alt={thread.title || t('common:newThread')}
                  className="size-10 rounded-md object-cover border"
                />
              )}
            </div>
            <DialogFooter>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setLogoDialogOpen(false)}
              >
                {t('common:cancel')}
              </Button>
              <Button
                size="sm"
                onClick={handleSaveChatLogo}
                disabled={chatLogo.trim() === currentChatLogo}
              >
                {t('common:save')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SidebarMenuItem>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onSelect={() => setRenameOpen(true)}>
            <Pencil className="size-4 mr-2" />
            <span>{t('common:rename')}</span>
          </ContextMenuItem>
          {onTogglePin && (
            <ContextMenuItem onSelect={() => onTogglePin(thread.id)}>
              {isPinned ? (
                <>
                  <PinOff className="size-4 mr-2" />
                  <span>Unpin</span>
                </>
              ) : (
                <>
                  <Pin className="size-4 mr-2" />
                  <span>Pin</span>
                </>
              )}
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => setDeleteConfirmOpen(true)}
          >
            <Trash2 className="size-4 mr-2" />
            <span>{t('common:delete')}</span>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )
  }
)

type ThreadListProps = {
  threads: Thread[]
  currentProjectId?: string
  onTogglePin?: (threadId: string) => void
  pinnedSet?: Set<string>
}

function ThreadList({ threads, currentProjectId, onTogglePin, pinnedSet }: ThreadListProps) {
  const { isMobile } = useSidebar()

  const sortedThreads = useMemo(() => {
    return [...threads].sort((a, b) => {
      return (b.updated || 0) - (a.updated || 0)
    })
  }, [threads])

  return (
    <>
      {sortedThreads.map((thread) => (
        <ThreadItem
          key={thread.id}
          thread={thread}
          isMobile={isMobile}
          currentProjectId={currentProjectId}
          onTogglePin={onTogglePin}
          isPinned={pinnedSet?.has(thread.id)}
        />
      ))}
    </>
  )
}

export default memo(ThreadList)
