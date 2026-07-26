import {
  Check,
  Download,
  FolderInput,
  ImagePlus,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Tag,
  Trash2,
} from 'lucide-react'
import { CHAT_EXPORT_OPTIONS, exportThread } from '@/lib/export/thread-export'
import { useThreads } from '@/hooks/threads/useThreads'
import { useChatOrganizationStore } from '@/hooks/threads/useChatOrganization'
import { NamePromptDialog } from '@/containers/dialogs/chat-organization/NamePromptDialog'
import { memo, useCallback, useMemo, useState } from 'react'

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { useSidebar } from '@/components/ui/sidebar-context'
import { useTranslation } from '@/i18n/react-i18next-compat'
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

function normalizeLogoImageUrl(url: string): string | undefined {
  const trimmed = url.trim()
  if (!trimmed) return undefined

  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href
    }
    if (parsed.protocol === 'data:') {
      return /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/]+={0,2}$/i.test(
        trimmed
      )
        ? trimmed
        : undefined
    }
    return undefined
  } catch {
    return undefined
  }
}

function ChatLogoImage({
  src,
  alt,
  className,
}: {
  src: string
  alt: string
  className?: string
}) {
  return (
    <img
      src={src}
      alt={alt}
      className={cn('size-4 rounded-sm object-cover', className)}
      loading="lazy"
    />
  )
}

function PinActionContent({
  isPinned,
  iconClassName,
}: {
  isPinned?: boolean
  iconClassName?: string
}) {
  return isPinned ? (
    <>
      <PinOff className={cn('size-4', iconClassName)} />
      <span>Unpin</span>
    </>
  ) : (
    <>
      <Pin className={cn('size-4', iconClassName)} />
      <span>Pin</span>
    </>
  )
}

const ThreadItem = memo(
  ({
    thread,
    isMobile,
    onTogglePin,
    isPinned,
  }: {
    thread: Thread
    isMobile: boolean
    onTogglePin?: (threadId: string) => void
    isPinned?: boolean
  }) => {
    const deleteThread = useThreads((state) => state.deleteThread)
    const renameThread = useThreads((state) => state.renameThread)
    const updateThread = useThreads((state) => state.updateThread)
    const {
      folders: chatFolders,
      tags: chatTags,
      addFolder: addChatFolder,
      addTag: addChatTag,
      assignFolder,
      setThreadTags,
    } = useChatOrganizationStore()
    const { t } = useTranslation()
    const [renameOpen, setRenameOpen] = useState(false)
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
    const [logoDialogOpen, setLogoDialogOpen] = useState(false)
    const [chatLogo, setChatLogo] = useState('')
    const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false)
    const [newTagDialogOpen, setNewTagDialogOpen] = useState(false)
    const threadTitle = thread.title || t('common:newThread')

    const plainTitleForRename = useMemo(() => {
      return (thread.title || '').replace(/<span[^>]*>|<\/span>/g, '')
    }, [thread.title])

    const currentChatLogo = useMemo(() => {
      const logo =
        typeof thread.metadata?.chatLogo === 'string'
          ? thread.metadata.chatLogo
          : ''
      return normalizeLogoImageUrl(logo) ?? ''
    }, [thread.metadata])

    const chatLogoPreviewUrl = useMemo(() => {
      return normalizeLogoImageUrl(chatLogo)
    }, [chatLogo])

    // Chat folders/tags (plain organization; exclusive folder membership).
    const currentChatFolderId = thread.metadata?.folderId
    const threadTagIds = useMemo(
      () => thread.metadata?.tagIds ?? [],
      [thread.metadata]
    )
    const sortedChatFolders = useMemo(
      () => [...chatFolders].sort((a, b) => b.updatedAt - a.updatedAt),
      [chatFolders]
    )

    const handleAssignFolder = useCallback(
      (folderId: string | null) => {
        if (folderId === (currentChatFolderId ?? null)) return
        assignFolder(thread.id, folderId)
        const folderName = folderId
          ? chatFolders.find((folder) => folder.id === folderId)?.name
          : undefined
        toast.success(
          folderId && folderName
            ? t('common:chatOrganization.movedToFolder', { folderName })
            : t('common:chatOrganization.removedFromFolder')
        )
      },
      [assignFolder, thread.id, chatFolders, currentChatFolderId, t]
    )

    const handleToggleTag = useCallback(
      (tagId: string) => {
        const current = thread.metadata?.tagIds ?? []
        const next = current.includes(tagId)
          ? current.filter((id) => id !== tagId)
          : [...current, tagId]
        setThreadTags(thread.id, next)
      },
      [setThreadTags, thread.id, thread.metadata]
    )

    const handleCreateFolder = useCallback(
      async (name: string) => {
        try {
          const folder = await addChatFolder(name)
          assignFolder(thread.id, folder.id)
          toast.success(
            t('common:chatOrganization.folderCreated', {
              folderName: folder.name,
            })
          )
          setNewFolderDialogOpen(false)
        } catch (error) {
          console.error('Create folder error:', error)
          toast.error(t('common:error'))
        }
      },
      [addChatFolder, assignFolder, thread.id, t]
    )

    const handleCreateTag = useCallback(
      async (name: string) => {
        try {
          const tag = await addChatTag(name)
          const current = thread.metadata?.tagIds ?? []
          if (!current.includes(tag.id)) {
            setThreadTags(thread.id, [...current, tag.id])
          }
          toast.success(
            t('common:chatOrganization.tagCreated', { tagName: tag.name })
          )
          setNewTagDialogOpen(false)
        } catch (error) {
          console.error('Create tag error:', error)
          toast.error(
            t('common:chatOrganization.tagAlreadyExists', { tagName: name })
          )
        }
      },
      [addChatTag, setThreadTags, thread.id, thread.metadata, t]
    )

    const handleSaveChatLogo = useCallback(() => {
      const trimmedLogo = chatLogo.trim()
      const normalizedLogo = trimmedLogo
        ? normalizeLogoImageUrl(trimmedLogo)
        : undefined
      if (trimmedLogo && !normalizedLogo) {
        toast.error(
          t('common:invalidImageUrl', { defaultValue: 'Invalid image URL.' })
        )
        return
      }
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

    const handleChatLogoFileChange = useCallback(
      (file?: File) => {
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
          setChatLogo(String(reader.result || ''))
        }
        reader.onerror = () => {
          toast.error(t('error'))
        }
        reader.readAsDataURL(file)
      },
      [t]
    )

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link to="/threads/$threadId" params={{ threadId: thread.id }}>
                {currentChatLogo && (
                  <ChatLogoImage src={currentChatLogo} alt={threadTitle} />
                )}
                <span>{threadTitle}</span>
              </Link>
            </SidebarMenuButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuAction
                  showOnHover
                  className="hover:bg-sidebar-foreground/8"
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
                    <PinActionContent isPinned={isPinned} />
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
                    <FolderInput className="size-4" />
                    <span>{t('common:chatOrganization.moveToFolder')}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-60 min-w-44 overflow-y-auto">
                    <DropdownMenuItem
                      onSelect={() => handleAssignFolder(null)}
                    >
                      <Check
                        className={cn(
                          'size-4',
                          currentChatFolderId && 'invisible'
                        )}
                      />
                      <span>{t('common:chatOrganization.noFolder')}</span>
                    </DropdownMenuItem>
                    {sortedChatFolders.map((folder) => (
                      <DropdownMenuItem
                        key={folder.id}
                        onSelect={() => handleAssignFolder(folder.id)}
                      >
                        <Check
                          className={cn(
                            'size-4',
                            currentChatFolderId !== folder.id && 'invisible'
                          )}
                        />
                        <span className="truncate max-w-[200px]">
                          {folder.name}
                        </span>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => setNewFolderDialogOpen(true)}
                    >
                      <Plus className="size-4" />
                      <span>{t('common:chatOrganization.newFolder')}…</span>
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="gap-2">
                    <Tag className="size-4" />
                    <span>{t('common:chatOrganization.editTags')}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-60 min-w-44 overflow-y-auto">
                    {chatTags.length === 0 ? (
                      <DropdownMenuItem disabled>
                        <span className="text-muted-foreground">
                          {t('common:chatOrganization.noTagsYet')}
                        </span>
                      </DropdownMenuItem>
                    ) : (
                      chatTags.map((tag) => (
                        <DropdownMenuCheckboxItem
                          key={tag.id}
                          checked={threadTagIds.includes(tag.id)}
                          onCheckedChange={() => handleToggleTag(tag.id)}
                          // Keep the submenu open so several tags can be toggled.
                          onSelect={(e) => e.preventDefault()}
                        >
                          <span className="truncate max-w-[200px]">
                            {tag.name}
                          </span>
                        </DropdownMenuCheckboxItem>
                      ))
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setNewTagDialogOpen(true)}>
                      <Plus className="size-4" />
                      <span>{t('common:chatOrganization.newTag')}…</span>
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="gap-2">
                    <Download className="size-4" />
                    <span>Export Chat</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="min-w-36">
                    {CHAT_EXPORT_OPTIONS.map((option) => (
                      <DropdownMenuItem
                        key={option.format}
                        onSelect={() => exportThread(thread, option.format)}
                      >
                        <span>{option.label}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
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
                  {chatLogoPreviewUrl && (
                    <img
                      src={chatLogoPreviewUrl}
                      alt={threadTitle}
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
                    disabled={(chatLogoPreviewUrl ?? '') === currentChatLogo}
                  >
                    {t('common:save')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <NamePromptDialog
              open={newFolderDialogOpen}
              onOpenChange={setNewFolderDialogOpen}
              title={t('common:chatOrganization.newFolder')}
              placeholder={t('common:chatOrganization.folderNamePlaceholder')}
              onSubmit={handleCreateFolder}
            />

            <NamePromptDialog
              open={newTagDialogOpen}
              onOpenChange={setNewTagDialogOpen}
              title={t('common:chatOrganization.newTag')}
              placeholder={t('common:chatOrganization.tagNamePlaceholder')}
              onSubmit={handleCreateTag}
            />
          </SidebarMenuItem>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onSelect={() => setRenameOpen(true)}>
            <Pencil className="size-4 mr-2" />
            <span>{t('common:rename')}</span>
          </ContextMenuItem>
          {onTogglePin && (
            <ContextMenuItem onSelect={() => onTogglePin(thread.id)}>
              <PinActionContent isPinned={isPinned} iconClassName="mr-2" />
            </ContextMenuItem>
          )}
          <ContextMenuSub>
              <ContextMenuSubTrigger className="gap-2">
                <FolderInput className="size-4 mr-2" />
                <span>{t('common:chatOrganization.moveToFolder')}</span>
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-48 max-h-60 overflow-y-auto">
                <ContextMenuItem onSelect={() => handleAssignFolder(null)}>
                  <Check
                    className={cn(
                      'size-4 mr-2',
                      currentChatFolderId && 'invisible'
                    )}
                  />
                  <span>{t('common:chatOrganization.noFolder')}</span>
                </ContextMenuItem>
                {sortedChatFolders.map((folder) => (
                  <ContextMenuItem
                    key={folder.id}
                    onSelect={() => handleAssignFolder(folder.id)}
                  >
                    <Check
                      className={cn(
                        'size-4 mr-2',
                        currentChatFolderId !== folder.id && 'invisible'
                      )}
                    />
                    <span className="truncate max-w-[200px]">
                      {folder.name}
                    </span>
                  </ContextMenuItem>
                ))}
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => setNewFolderDialogOpen(true)}>
                  <Plus className="size-4 mr-2" />
                  <span>{t('common:chatOrganization.newFolder')}…</span>
                </ContextMenuItem>
              </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSub>
            <ContextMenuSubTrigger className="gap-2">
              <Tag className="size-4 mr-2" />
              <span>{t('common:chatOrganization.editTags')}</span>
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-48 max-h-60 overflow-y-auto">
              {chatTags.length === 0 ? (
                <ContextMenuItem disabled>
                  <span className="text-muted-foreground">
                    {t('common:chatOrganization.noTagsYet')}
                  </span>
                </ContextMenuItem>
              ) : (
                chatTags.map((tag) => (
                  <ContextMenuCheckboxItem
                    key={tag.id}
                    checked={threadTagIds.includes(tag.id)}
                    onCheckedChange={() => handleToggleTag(tag.id)}
                    // Keep the submenu open so several tags can be toggled.
                    onSelect={(e) => e.preventDefault()}
                  >
                    <span className="truncate max-w-[200px]">{tag.name}</span>
                  </ContextMenuCheckboxItem>
                ))
              )}
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => setNewTagDialogOpen(true)}>
                <Plus className="size-4 mr-2" />
                <span>{t('common:chatOrganization.newTag')}…</span>
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
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
  onTogglePin?: (threadId: string) => void
  pinnedSet?: Set<string>
}

function ThreadList({
  threads,
  onTogglePin,
  pinnedSet,
}: ThreadListProps) {
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
          onTogglePin={onTogglePin}
          isPinned={pinnedSet?.has(thread.id)}
        />
      ))}
    </>
  )
}

const MemoizedThreadList = memo(ThreadList)

export { MemoizedThreadList as ThreadList }
