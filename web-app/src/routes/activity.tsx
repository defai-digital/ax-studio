import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import { ActivityTimeline } from '@/components/activity/ActivityTimeline'
import { Activity, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useActivityFeed } from '@/hooks/activity/use-activity-feed'

export const Route = createFileRoute(route.activity)({
  component: ActivityPage,
})

function ActivityPage() {
  const eventCount = useActivityFeed((s) => s.events.length)
  const clearEvents = useActivityFeed((s) => s.clearEvents)

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className="font-medium text-base font-studio">Activity</span>
        </div>
      </HeaderPage>
      <div className="flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/40 bg-background sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div
              className="size-7 rounded-lg flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              }}
            >
              <Activity className="size-3.5 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <h1
                className="text-foreground tracking-tight"
                style={{ fontSize: '16px', fontWeight: 600 }}
              >
                Activity Feed
              </h1>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                What your AI has been working on
              </p>
            </div>
          </div>
          {eventCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={clearEvents}
              className="h-7 text-xs text-muted-foreground gap-1.5"
            >
              <Trash2 className="size-3" />
              Clear
            </Button>
          )}
        </div>

        {/* Timeline */}
        <div className="flex-1 min-h-0">
          <ActivityTimeline />
        </div>
      </div>
    </div>
  )
}
