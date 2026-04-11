import { ScrollArea } from '@/components/ui/scroll-area'
import type { DiffSegment } from '@/lib/diff/compute-diff'

interface DiffViewerProps {
  segments: DiffSegment[]
  maxHeight?: string
}

export function DiffViewer({ segments, maxHeight = '300px' }: DiffViewerProps) {
  if (segments.length === 0) return null

  return (
    <ScrollArea className="rounded-md border border-border" style={{ maxHeight }}>
      <div className="p-3 text-sm font-mono leading-relaxed whitespace-pre-wrap">
        {segments.map((seg, i) => {
          if (seg.type === 'added') {
            return (
              <span
                key={i}
                className="bg-green-500/15 text-green-700 dark:text-green-300 rounded-sm px-0.5"
              >
                {seg.value}
              </span>
            )
          }
          if (seg.type === 'removed') {
            return (
              <span
                key={i}
                className="bg-red-500/15 text-red-700 dark:text-red-300 line-through rounded-sm px-0.5"
              >
                {seg.value}
              </span>
            )
          }
          return <span key={i}>{seg.value}</span>
        })}
      </div>
    </ScrollArea>
  )
}
