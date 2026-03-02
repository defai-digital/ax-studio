import { Folder, ImagePlus, MoreHorizontal, Pencil, Trash2, X } from 'lucide-react'
import { useThreads } from '@/hooks/useThreads'
import { useMessages } from '@/hooks/useMessages'
import { useThreadManagement } from '@/hooks/useThreadManagement'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useEffect, useRef } from 'react'

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
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { memo, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { RenameThreadDialog, DeleteThreadDialog } from '@/containers/dialogs'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ThreadMessage } from '@ax-fabric/core'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

const ThreadItem = memo(
  ({
    thread,
    isMobile,
    currentProjectId,
  }: {
    thread: Thread
    isMobile: boolean
    currentProjectId?: string
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

    const serviceHub = useServiceHub()
    const getMessages = useMessages((state) => state.getMessages)
    const setMessages = useMessages((state) => state.setMessages)

    // Use a ref to track if messages have been loaded
    const messagesLoadedRef = useRef(false)
    // Track current messages for comparison
    const messagesLengthRef = useRef(0)

    // Get messages reactively via ref tracking (to avoid infinite re-renders)
    const [messages, setLocalMessages] = useState<ThreadMessage[]>(() =>
      getMessages(thread.id)
    )

    // Fetch messages if not loaded yet
    useEffect(() => {
      const currentMessages = getMessages(thread.id)

      // Initial load: no messages yet, fetch them
      if (currentMessages.length === 0 && !messagesLoadedRef.current) {
        messagesLoadedRef.current = true
        serviceHub
          .messages()
          .fetchMessages(thread.id)
          .then((fetchedMessages) => {
            if (fetchedMessages) {
              setMessages(thread.id, fetchedMessages)
              setLocalMessages(fetchedMessages)
              messagesLengthRef.current = fetchedMessages.length
            }
          })
          .catch(() => {
            messagesLoadedRef.current = false
          })
        return
      }

      // Only update local state if messages length changed (prevents re-renders during streaming)
      if (currentMessages.length !== messagesLengthRef.current) {
        setLocalMessages(currentMessages)
        messagesLengthRef.current = currentMessages.length
      }
    }, [thread.id, serviceHub, getMessages, setMessages])

    const lastUserMessageText = useMemo(() => {
      const userMessages = messages.filter((m) => m.role === 'user')
      const lastUserMessage = userMessages[userMessages.length - 1]
      if (!lastUserMessage) return undefined
      const textContent = lastUserMessage.content?.find((c) => c.type === 'text')
      return textContent?.text?.value
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

    const assignThreadToProject = (threadId: string, projectId: string) => {
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
    }

    const handleSaveChatLogo = () => {
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
    }

    const handleChatLogoFileChange = (file?: File) => {
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        setChatLogo(String(reader.result || ''))
      }
      reader.onerror = () => {
        toast.error(t('error'))
      }
      reader.readAsDataURL(file)
    }

    return (
      <SidebarMenuItem>
        {currentProjectId ? 
          <Link to="/threads/$threadId" params={{ threadId: thread.id }} className="bg-card dark:bg-secondary/20 px-4 py-4 border hover:dark:bg-secondary/30 rounded-lg block">
              <div className="flex items-center gap-2">
                {currentChatLogo && (
                  <img
                    src={currentChatLogo}
                    alt={thread.title || t('common:newThread')}
                    className="size-4 rounded-sm object-cover"
                  />
                )}
                <span>{thread.title || t('common:newThread')}</span>
              </div>
              {currentProjectId && lastUserMessageText && (
                <div className="text-muted-foreground text-xs mt-1 line-clamp-1 pr-10">
                  {lastUserMessageText}
                </div>
              )}
          </Link>
          : 
          <SidebarMenuButton asChild>
            <Link to="/threads/$threadId" params={{ threadId: thread.id }}>
              {currentChatLogo && (
                <img
                  src={currentChatLogo}
                  alt={thread.title || t('common:newThread')}
                  className="size-4 rounded-sm object-cover"
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
              className={cn("hover:bg-sidebar-foreground/8", currentProjectId && 'mt-4 mr-2')}
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
    )
  }
)

type ThreadListProps = {
  threads: Thread[]
  currentProjectId?: string
}

function ThreadList({ threads, currentProjectId }: ThreadListProps) {
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
        />
      ))}
    </>
  )
}

export default memo(ThreadList)
