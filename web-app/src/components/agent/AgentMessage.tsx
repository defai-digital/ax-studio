import { Bot, CircleStop, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import type { AgentLine, AgentStatus } from '@/hooks/agent/useAgentMode'
import { Button } from '@/components/ui/button'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import { useEffect, useRef } from 'react'

type Props = {
  lines: AgentLine[]
  status: AgentStatus
  onStop: () => void
  onReset: () => void
}

function LineIcon({ kind }: { kind: AgentLine['kind'] }) {
  if (kind === 'error') return <XCircle className="size-3 text-destructive shrink-0 mt-0.5" />
  return <span className="size-3 shrink-0" />
}

export function AgentMessage({ lines, status, onStop, onReset }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div className="flex gap-3 w-full">
      {/* Bot avatar */}
      <div className="flex-shrink-0 mt-1">
        <div className="size-7 rounded-full bg-primary/10 flex items-center justify-center">
          <Bot className="size-4 text-primary" />
        </div>
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        {/* Header */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">AutomatosX Agent</span>
          {status === 'running' && (
            <span className="flex items-center gap-1 text-xs text-primary">
              <Loader2 className="size-3 animate-spin" />
              Running...
            </span>
          )}
          {status === 'done' && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle className="size-3" />
              Done
            </span>
          )}
          {status === 'error' && (
            <span className="flex items-center gap-1 text-xs text-destructive">
              <XCircle className="size-3" />
              Failed
            </span>
          )}
        </div>

        {/* Output lines */}
        {lines.length > 0 && (
          <div className="max-h-[500px] overflow-y-auto rounded-md bg-muted/50 border p-3 space-y-2 text-sm">
            {lines.map((line, i) => (
              <div key={i} className={line.kind === 'error' ? 'text-destructive text-xs font-mono' : ''}>
                {line.kind === 'error' ? (
                  <span>{line.text}</span>
                ) : (
                  <RenderMarkdown content={line.text} />
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          {status === 'running' && (
            <Button size="sm" variant="outline" onClick={onStop} className="h-7 text-xs gap-1">
              <CircleStop className="size-3" />
              Stop
            </Button>
          )}
          {(status === 'done' || status === 'error') && (
            <Button size="sm" variant="ghost" onClick={onReset} className="h-7 text-xs">
              Run Again
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
