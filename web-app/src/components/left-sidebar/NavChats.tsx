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
import {
  Download,
  GripVertical,
  MessageSquarePlus,
  MoreHorizontal,
  Pin,
  PinOff,
  Pencil,
  Trash2,
} from 'lucide-react'
import {
  CHAT_EXPORT_OPTIONS,
  exportAllThreads,
  exportThread,
} from '@/lib/export/thread-export'
import {
  type HTMLAttributes,
  type ReactNode,
  memo,
  useCallback,
  useMemo,
  useState,
} from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useThreads } from '@/hooks/threads/useThreads'
import { ThreadList } from '@/containers/ThreadList'
import { DeleteAllThreadsDialog } from '@/containers/dialogs/thread/DeleteAllThreadsDialog'
import { groupByDate, type DateGroup } from '@/lib/utils/date-group'
import { usePinnedThreads } from '@/hooks/threads/usePinnedThreads'
import { Link } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { RenameThreadDialog, DeleteThreadDialog } from '@/containers/dialogs'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'

export function NavChats() {
  const { t } = useTranslation()
  const threads = useThreads((state) => state.threads)
  const deleteAllThreads = useThreads((state) => state.deleteAllThreads)
  const renameThread = useThreads((state) => state.renameThread)
  const deleteThread = useThreads((state) => state.deleteThread)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const { pinnedIds, pinnedSet, togglePin, reorder } = usePinnedThreads()

  const threadsWithoutProject = useMemo(() => {
    return Object.values(threads).filter(
      (thread) => thread.id !== TEMPORARY_CHAT_ID && !thread.metadata?.project
    )
  }, [threads])

  const groupedThreads = useMemo(() => {
    return groupByDate(
      threadsWithoutProject,
      (thread) => (thread.updated || 0) * 1000 || Date.now(),
      pinnedSet,
      (thread) => thread.id
    )
  }, [threadsWithoutProject, pinnedSet])

  // Resolve pinned threads in order
  const pinnedThreads = useMemo(() => {
    const threadMap = new Map(threadsWithoutProject.map((t) => [t.id, t]))
    return pinnedIds
      .map((id) => threadMap.get(id))
      .filter((t): t is Thread => t != null)
  }, [pinnedIds, threadsWithoutProject])

  if (threadsWithoutProject.length === 0) {
    return (
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>{t('common:chats')}</SidebarGroupLabel>
        <div className="flex flex-col items-center gap-2 px-2 py-4 text-center">
          <p className="text-xs text-sidebar-foreground/50">No chats yet</p>
          <SidebarMenuButton asChild className="w-auto">
            <Link to={route.home}>
              <MessageSquarePlus className="size-4" />
              <span>New Chat</span>
            </Link>
          </SidebarMenuButton>
        </div>
      </SidebarGroup>
    )
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
              {CHAT_EXPORT_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.format}
                  onSelect={() => {
                    setDropdownOpen(false)
                    exportAllThreads(option.format)
                  }}
                >
                  <span>{option.label}</span>
                </DropdownMenuItem>
              ))}
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
  dragHandleProps,
  onTogglePin,
  onRename,
  onDelete,
}: {
  thread: Thread
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>
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

  const title = thread.title || t('common:newThread')

  return (
    <SidebarMenuItem>
      {/* Keyboard-accessible drag handle (dnd-kit): focus it, press
          Space/Enter to lift, arrows to move, Space/Enter to drop. */}
      <button
        type="button"
        aria-label={`Reorder ${title}`}
        className="absolute left-1 top-1/2 -translate-y-1/2 z-10 flex size-5 items-center justify-center rounded cursor-grab active:cursor-grabbing touch-none text-sidebar-foreground/30 hover:text-sidebar-foreground focus-visible:ring-2 ring-sidebar-ring outline-hidden"
        {...dragHandleProps}
      >
        <GripVertical className="size-3 shrink-0" />
      </button>
      <SidebarMenuButton asChild className="pl-7">
        <Link to="/threads/$threadId" params={{ threadId: thread.id }}>
          <span>{title}</span>
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
            onSelect={() => setDeleteConfirmOpen(true)}
          >
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

function SortablePinnedThreadItem({
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
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: thread.id })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={isDragging ? 'relative z-10 opacity-70' : undefined}
    >
      <PinnedThreadItem
        thread={thread}
        dragHandleProps={{ ...attributes, ...listeners }}
        onTogglePin={onTogglePin}
        onRename={onRename}
        onDelete={onDelete}
      />
    </div>
  )
}

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
  const sensors = useSensors(
    // Distance constraint keeps plain clicks on the handle from starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      if (!over || active.id === over.id) return

      const fromIdx = pinnedIds.indexOf(String(active.id))
      const toIdx = pinnedIds.indexOf(String(over.id))
      if (fromIdx === -1 || toIdx === -1) return

      onReorder(arrayMove(pinnedIds, fromIdx, toIdx))
    },
    [pinnedIds, onReorder]
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={pinnedIds} strategy={verticalListSortingStrategy}>
        {threads.map((thread) => (
          <SortablePinnedThreadItem
            key={thread.id}
            thread={thread}
            onTogglePin={onTogglePin}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
      </SortableContext>
    </DndContext>
  )
}

/** Pinned section header — matches Figma: Pin icon + "Pinned" label */
function PinnedGroupSection({ children }: { children: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="px-2 pb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-sidebar-foreground/30 uppercase tracking-widest">
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
  children: ReactNode
}) {
  return (
    <div className="mb-4">
      <div className="px-2 pb-1.5 text-[12px] font-semibold text-sidebar-foreground/30 uppercase tracking-widest">
        {label}
      </div>
      {children}
    </div>
  )
}
