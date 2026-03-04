import { useEffect, useRef } from 'react'
import type { ResearchStep } from '@/hooks/useResearchPanel'

interface ResearchProgressProps {
  steps: ResearchStep[]
}

const STEP_ICON: Record<ResearchStep['type'], string> = {
  planning: '🗂',
  searching: '🔍',
  scraping: '🌐',
  summarising: '✂️',
  writing: '✍️',
  done: '✅',
  error: '❌',
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function ResearchProgress({ steps }: ResearchProgressProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [steps.length])

  if (steps.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Starting research…
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto p-3 space-y-1 font-mono text-xs">
      {steps.map((step, i) => {
        const icon = STEP_ICON[step.type] ?? '•'
        let label = ''
        switch (step.type) {
          case 'planning':
            label = step.message ?? 'Planning research…'
            break
          case 'searching':
            label = `Searching: ${step.query ?? ''}`
            break
          case 'scraping':
            label = step.message ?? `Fetching: ${step.title ?? step.url ?? ''}`
            break
          case 'summarising':
            label = step.message ?? `Summarising: ${step.url ?? ''}`
            break
          case 'writing':
            label = step.message ?? 'Writing report…'
            break
          case 'done':
            label = 'Research complete'
            break
          case 'error':
            label = `Error: ${step.message ?? 'Unknown error'}`
            break
        }

        return (
          <div
            key={i}
            className={`flex items-start gap-2 px-2 py-1 rounded ${
              step.type === 'error'
                ? 'text-destructive'
                : step.type === 'done'
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-foreground/80'
            }`}
          >
            <span className="shrink-0 mt-0.5">{icon}</span>
            <span className="flex-1 break-all">{label}</span>
            <span className="shrink-0 text-muted-foreground text-[10px] mt-0.5">
              {formatTime(step.timestamp)}
            </span>
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
