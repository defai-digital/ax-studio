import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarGroupAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuAction,
} from '@/components/ui/sidebar'
import { useSidebar } from '@/components/ui/sidebar-context'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Download, GripVertical, MoreHorizontal, Pin, PinOff, Pencil, Trash2 } from 'lucide-react'
import { exportThread, exportAllThreads } from '@/lib/thread-export'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useThreads } from '@/hooks/threads/useThreads'
import ThreadList from '@/containers/ThreadList'
import { DeleteAllThreadsDialog } from '@/containers/dialogs/thread/DeleteAllThreadsDialog'
import { groupByDate, type DateGroup } from '@/lib/date-group'
import { usePinnedThreads } from '@/hooks/threads/usePinnedThreads'
import { Link } from '@tanstack/react-router'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { RenameThreadDialog, DeleteThreadDialog } from '@/containers/dialogs'

export function NavChats() {
  const { t } = useTranslation()
  const getFilteredThreads = useThreads((state) => state.getFilteredThreads)
  const threads = useThreads((state) => state.threads)
  const deleteAllThreads = useThreads((state) => state.deleteAllThreads)
  const renameThread = useThreads((state) => state.renameThread)
  const deleteThread = useThreads((state) => state.deleteThread)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const { pinnedIds, pinnedSet, togglePin, reorder } = usePinnedThreads()

  const threadsWithoutProject = useMemo(() => {
    return getFilteredThreads('').filter((thread) => !thread.metadata?.project)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getFilteredThreads, threads])

  const groupedThreads = useMemo(() => {
    return groupByDate(
      threadsWithoutProject,
      (thread) => (thread.updated || 0) * 1000 || Date.now(),
      pinnedSet,
      (thread) => thread.id,
    )
  }, [threadsWithoutProject, pinnedSet])

  // Resolve pinned threads in order
  const pinnedThreads = useMemo(() => {
    const threadMap = new Map(
      threadsWithoutProject.map((t) => [t.id, t]),
    )
    return pinnedIds
      .map((id) => threadMap.get(id))
      .filter((t): t is Thread => t != null)
  }, [pinnedIds, threadsWithoutProject])

  if (threadsWithoutProject.length === 0) {
    return null
  }

  const nonPinnedGroups = groupedThreads.filter((g) => g.group !== 'Pinned')

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>{t('common:chats')}</SidebarGroupLabel>
      <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
        <DropdownMenuTrigger asChild>
          <SidebarGroupAction className="hover:bg-sidebar-foreground/8">
            <MoreHorizontal className="text-muted-foreground" />
            <span className="sr-only">More</span>
          </SidebarGroupAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="gap-2">
              <Download className="size-4" />
              <span>Export All Chats</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-36">
              <DropdownMenuItem onSelect={() => { setDropdownOpen(false); exportAllThreads('json') }}>
                <span>JSON</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setDropdownOpen(false); exportAllThreads('csv') }}>
                <span>CSV</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setDropdownOpen(false); exportAllThreads('alpaca') }}>
                <span>JSON (Alpaca)</span>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setDropdownOpen(false); exportAllThreads('openai-jsonl') }}>
                <span>JSONL (OpenAI)</span>
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DeleteAllThreadsDialog
            onDeleteAll={deleteAllThreads}
            onDropdownClose={() => setDropdownOpen(false)}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <SidebarMenu>
        {/* Pinned threads section with drag reorder */}
        {pinnedThreads.length > 0 && (
          <PinnedGroupSection>
            <DraggablePinnedList
              threads={pinnedThreads}
              pinnedIds={pinnedIds}
              onReorder={reorder}
              onTogglePin={togglePin}
              onRename={renameThread}
              onDelete={deleteThread}
            />
          </PinnedGroupSection>
        )}

        {/* Regular date-grouped threads */}
        {nonPinnedGroups.map((group) => (
          <DateGroupSection key={group.group} label={group.group}>
            <ThreadList
              threads={group.items}
              onTogglePin={togglePin}
              pinnedSet={pinnedSet}
            />
          </DateGroupSection>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}

const PinnedThreadItem = memo(function PinnedThreadItem({
  thread,
  onTogglePin,
  onRename,
  onDelete,
}: {
  thread: Thread
  onTogglePin: (id: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}) {
  const { isMobile } = useSidebar()
  const { t } = useTranslation()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  const plainTitleForRename = useMemo(() => {
    return (thread.title || '').replace(/<span[^>]*>|<\/span>/g, '')
  }, [thread.title])

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild className="cursor-grab active:cursor-grabbing">
        <Link to="/threads/$threadId" params={{ threadId: thread.id }}>
          <GripVertical className="size-3 text-sidebar-foreground/30 shrink-0" />
          <span>{thread.title || t('common:newThread')}</span>
        </Link>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover className="hover:bg-sidebar-foreground/8">
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
          <DropdownMenuItem onSelect={() => onTogglePin(thread.id)}>
            <PinOff className="size-4" />
            <span>{t('common:unpin')}</span>
          </DropdownMenuItem>
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
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleteConfirmOpen(true)}>
            <Trash2 className="size-4" />
            <span>{t('common:delete')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameThreadDialog
        thread={thread}
        plainTitleForRename={plainTitleForRename}
        onRename={onRename}
        open={renameOpen}
        onOpenChange={setRenameOpen}
        withoutTrigger
      />

      <DeleteThreadDialog
        thread={thread}
        onDelete={onDelete}
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        withoutTrigger
      />
    </SidebarMenuItem>
  )
})

function DraggablePinnedList({
  threads,
  pinnedIds,
  onReorder,
  onTogglePin,
  onRename,
  onDelete,
}: {
  threads: Thread[]
  pinnedIds: string[]
  onReorder: (ids: string[]) => void
  onTogglePin: (id: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}) {
  const dragItemRef = useRef<string | null>(null)
  const dragOverRef = useRef<string | null>(null)

  const handleDragStart = useCallback((threadId: string) => {
    dragItemRef.current = threadId
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, threadId: string) => {
    e.preventDefault()
    dragOverRef.current = threadId
  }, [])

  const handleDrop = useCallback(() => {
    if (!dragItemRef.current || !dragOverRef.current) return
    if (dragItemRef.current === dragOverRef.current) return

    const fromIdx = pinnedIds.indexOf(dragItemRef.current)
    const toIdx = pinnedIds.indexOf(dragOverRef.current)
    if (fromIdx === -1 || toIdx === -1) return

    const newOrder = [...pinnedIds]
    newOrder.splice(fromIdx, 1)
    newOrder.splice(toIdx, 0, dragItemRef.current)
    onReorder(newOrder)

    dragItemRef.current = null
    dragOverRef.current = null
  }, [pinnedIds, onReorder])

  return (
    <>
      {threads.map((thread) => (
        <div
          key={thread.id}
          draggable
          onDragStart={() => handleDragStart(thread.id)}
          onDragOver={(e) => handleDragOver(e, thread.id)}
          onDrop={handleDrop}
        >
          <PinnedThreadItem
            thread={thread}
            onTogglePin={onTogglePin}
            onRename={onRename}
            onDelete={onDelete}
          />
        </div>
      ))}
    </>
  )
}

/** Pinned section header — matches Figma: Pin icon + "Pinned" label */
function PinnedGroupSection({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="mb-4">
      <div className="px-2 pb-1.5 flex items-center gap-1.5 text-[10px] font-semibold text-sidebar-foreground/30 uppercase tracking-widest">
        <Pin className="size-2.5" />
        Pinned
      </div>
      {children}
    </div>
  )
}

/** Date group section — matches Figma: mb-4 spacing, /30 opacity label */
function DateGroupSection({
  label,
  children,
}: {
  label: DateGroup
  children: React.ReactNode
}) {
  return (
    <div className="mb-4">
      <div className="px-2 pb-1.5 text-[10px] font-semibold text-sidebar-foreground/30 uppercase tracking-widest">
        {label}
      </div>
      {children}
    </div>
  )
}
