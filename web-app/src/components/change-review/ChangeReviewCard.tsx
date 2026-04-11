import { useMemo } from 'react'
import { Check, X, FileEdit } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DiffViewer } from './DiffViewer'
import { computeDiff } from '@/lib/diff/compute-diff'
import { generateChangeSummary } from '@/lib/diff/change-summary'
import type { ContentVersion } from '@/hooks/versions/use-content-versions'

interface ChangeReviewCardProps {
  version: ContentVersion
  onAccept: () => void
  onReject: () => void
}

export function ChangeReviewCard({ version, onAccept, onReject }: ChangeReviewCardProps) {
  const segments = useMemo(
    () => computeDiff(version.before, version.after),
    [version.before, version.after]
  )

  const summary = useMemo(
    () => version.summary || generateChangeSummary(segments),
    [version.summary, segments]
  )

  if (version.status === 'accepted') {
    return (
      <div className="mt-3 flex items-center gap-2 text-[11px] text-green-600 dark:text-green-400">
        <Check className="size-3.5" />
        <span>Changes accepted</span>
      </div>
    )
  }

  if (version.status === 'rejected') {
    return (
      <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
        <X className="size-3.5" />
        <span>Changes rejected — showing original</span>
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <FileEdit className="size-3.5 text-muted-foreground" />
        <span className="text-[12px] text-foreground font-medium">{summary}</span>
      </div>

      {/* Diff */}
      <div className="p-2">
        <DiffViewer segments={segments} maxHeight="250px" />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-border">
        <Button size="sm" variant="default" onClick={onAccept} className="h-7 text-xs gap-1.5">
          <Check className="size-3" />
          Accept
        </Button>
        <Button size="sm" variant="outline" onClick={onReject} className="h-7 text-xs gap-1.5">
          <X className="size-3" />
          Reject
        </Button>
      </div>
    </div>
  )
}
