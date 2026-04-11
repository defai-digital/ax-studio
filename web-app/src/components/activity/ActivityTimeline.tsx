import { useNavigate } from '@tanstack/react-router'
import {
  Search,
  FileEdit,
  Database,
  MessageSquare,
  Users,
  ChevronRight,
} from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  useActivityFeed,
  groupEventsByDate,
  type ActivityType,
} from '@/hooks/activity/use-activity-feed'

const typeConfig: Record<ActivityType, { icon: typeof Search; color: string }> = {
  research: { icon: Search, color: 'text-violet-500' },
  edit: { icon: FileEdit, color: 'text-emerald-500' },
  'knowledge-base': { icon: Database, color: 'text-cyan-500' },
  chat: { icon: MessageSquare, color: 'text-blue-500' },
  'agent-team': { icon: Users, color: 'text-amber-500' },
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ActivityTimeline() {
  const events = useActivityFeed((s) => s.events)
  const navigate = useNavigate()
  const groups = groupEventsByDate(events)

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <MessageSquare className="size-8 mb-3 opacity-30" />
        <p className="text-sm">No activity yet.</p>
        <p className="text-xs mt-1 opacity-70">
          Your AI activity will appear here as you work.
        </p>
      </div>
    )
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-6 p-4">
        {groups.map((group) => (
          <div key={group.label}>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
              {group.label}
            </h3>
            <div className="space-y-1">
              {group.events.map((event) => {
                const config = typeConfig[event.type] ?? typeConfig.chat
                const Icon = config.icon

                return (
                  <button
                    key={event.id}
                    onClick={() => {
                      if (event.threadId) {
                        navigate({ to: '/threads/$threadId', params: { threadId: event.threadId } })
                      }
                    }}
                    disabled={!event.threadId}
                    className="w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/50 transition-colors group/event"
                    type="button"
                  >
                    {/* Time */}
                    <span className="text-[11px] text-muted-foreground font-mono shrink-0 mt-0.5 w-11">
                      {formatTime(event.timestamp)}
                    </span>

                    {/* Icon */}
                    <div className={`shrink-0 mt-0.5 ${config.color}`}>
                      <Icon className="size-3.5" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-foreground font-medium truncate">
                        {event.title}
                      </p>
                      {event.detail && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                          {event.detail}
                        </p>
                      )}
                      {event.threadTitle && (
                        <p className="text-[10px] text-primary mt-1 truncate flex items-center gap-1">
                          <ChevronRight className="size-2.5" />
                          {event.projectName ? `${event.projectName} / ` : ''}
                          {event.threadTitle}
                        </p>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  )
}
