import { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Folder as FolderIcon,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { useSidebar } from '@/components/ui/sidebar-context'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { toast } from 'sonner'
import { ThreadList } from '@/containers/ThreadList'
import { useChatOrganizationStore } from '@/hooks/threads/useChatOrganization'
import type { ChatFolder } from '@/lib/chat-organization'
import { NamePromptDialog } from '@/containers/dialogs/chat-organization/NamePromptDialog'
import { DeleteChatFolderDialog } from '@/containers/dialogs/chat-organization/DeleteChatFolderDialog'

function ChatFolderRow({
  folder,
  members,
  collapsed,
  showEmptyHint,
  isMobile,
  onToggleCollapsed,
  onTogglePin,
  pinnedSet,
  onRename,
  onDelete,
}: {
  folder: ChatFolder
  members: Thread[]
  collapsed: boolean
  showEmptyHint: boolean
  isMobile: boolean
  onToggleCollapsed: () => void
  onTogglePin?: (threadId: string) => void
  pinnedSet?: Set<string>
  onRename: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()

  return (
    <>
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={`${folder.name} — ${t('common:chatOrganization.chatCount', { count: members.length })}`}
        >
          {collapsed ? (
            <ChevronRight className="size-4 shrink-0" />
          ) : (
            <ChevronDown className="size-4 shrink-0" />
          )}
          <FolderIcon className="size-4 shrink-0 text-foreground/70" />
          <span className="truncate">{folder.name}</span>
          <span className="ml-auto text-[11px] text-sidebar-foreground/40">
            {members.length}
          </span>
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
            <DropdownMenuItem onSelect={onRename}>
              <Pencil className="size-4" />
              <span>{t('common:chatOrganization.renameFolder')}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 className="size-4" />
              <span>{t('common:chatOrganization.deleteFolder')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
      {!collapsed &&
        (members.length > 0 ? (
          <ThreadList
            threads={members}
            onTogglePin={onTogglePin}
            pinnedSet={pinnedSet}
          />
        ) : showEmptyHint ? (
          <div className="px-2 py-1.5 text-[12px] text-sidebar-foreground/40">
            {t('common:chatOrganization.emptyFolderHint')}
          </div>
        ) : null)}
    </>
  )
}

/**
 * Folders block of the chats sidebar: one collapsible row per folder with a
 * member count and a Rename/Delete menu. Folders are plain organization
 * (single-level, exclusive membership) — unrelated to projects.
 */
export function ChatFolderSection({
  folders,
  membersByFolder,
  showEmptyHints,
  onTogglePin,
  pinnedSet,
}: {
  /** Folders sorted by updatedAt desc (v1: no manual reorder). */
  folders: ChatFolder[]
  /** Member chats per folder id (already tag-filtered). */
  membersByFolder: Map<string, Thread[]>
  /** Whether expanded empty folders show the "No chats yet" hint. */
  showEmptyHints: boolean
  onTogglePin?: (threadId: string) => void
  pinnedSet?: Set<string>
}) {
  const { t } = useTranslation()
  const { isMobile } = useSidebar()
  const { collapsedFolderIds, toggleFolderCollapsed, renameFolder } =
    useChatOrganizationStore()
  const [renameTarget, setRenameTarget] = useState<ChatFolder | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ChatFolder | null>(null)

  if (folders.length === 0) return null

  return (
    <div className="mb-4" data-testid="chat-folder-section">
      <div className="px-2 pb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-sidebar-foreground/30 uppercase tracking-widest">
        <FolderIcon className="size-2.5" />
        {t('common:chatOrganization.folders')}
      </div>
      {folders.map((folder) => (
        <ChatFolderRow
          key={folder.id}
          folder={folder}
          members={membersByFolder.get(folder.id) ?? []}
          collapsed={collapsedFolderIds.includes(folder.id)}
          showEmptyHint={showEmptyHints}
          isMobile={isMobile}
          onToggleCollapsed={() => toggleFolderCollapsed(folder.id)}
          onTogglePin={onTogglePin}
          pinnedSet={pinnedSet}
          onRename={() => setRenameTarget(folder)}
          onDelete={() => setDeleteTarget(folder)}
        />
      ))}

      <NamePromptDialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null)
        }}
        title={t('common:chatOrganization.renameFolder')}
        placeholder={t('common:chatOrganization.folderNamePlaceholder')}
        initialValue={renameTarget?.name ?? ''}
        onSubmit={async (name) => {
          if (!renameTarget) return
          await renameFolder(renameTarget.id, name)
          toast.success(t('common:chatOrganization.folderRenamed'))
          setRenameTarget(null)
        }}
      />

      <DeleteChatFolderDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        folder={deleteTarget}
      />
    </div>
  )
}
