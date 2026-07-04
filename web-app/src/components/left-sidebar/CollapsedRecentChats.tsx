/**
 * CollapsedRecentChats — a recent-chats flyout shown only when the sidebar is
 * collapsed to icons. In collapsed mode NavChats/NavProjects are hidden, which
 * otherwise leaves conversation history unreachable without re-expanding; this
 * keeps quick access to the most recent threads one click away.
 */
import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { History, MessageCircle } from 'lucide-react'
import { useThreads } from '@/hooks/threads/useThreads'
import { route } from '@/constants/routes'
import { TEMPORARY_CHAT_ID } from '@/constants/chat'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'

const MAX_RECENT = 10

export function CollapsedRecentChats() {
  const { t } = useTranslation()
  const threads = useThreads((state) => state.threads)
  const [open, setOpen] = useState(false)

  const recent = useMemo(
    () =>
      Object.values(threads)
        .filter((thread) => thread.id !== TEMPORARY_CHAT_ID)
        .sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))
        .slice(0, MAX_RECENT),
    [threads]
  )

  if (recent.length === 0) return null

  const label = t('common:chats', { defaultValue: 'Chats' })

  // Only rendered in collapsed ("icon") mode.
  return (
    <SidebarMenuItem className="hidden group-data-[collapsible=icon]:block">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <SidebarMenuButton tooltip={label} aria-label={label}>
            <History className="text-foreground/70" size={16} />
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          className="w-64 p-1.5"
        >
          <p className="px-2 py-1 text-[10px] font-semibold tracking-widest uppercase text-muted-foreground/40">
            {label}
          </p>
          <div className="flex flex-col">
            {recent.map((thread) => (
              <Link
                key={thread.id}
                to={route.threadsDetail}
                params={{ threadId: thread.id }}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors min-w-0"
              >
                <MessageCircle className="size-3.5 shrink-0" />
                <span className="truncate">
                  {thread.title || 'New Thread'}
                </span>
              </Link>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </SidebarMenuItem>
  )
}
