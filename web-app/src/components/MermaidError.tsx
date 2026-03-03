import { memo, useState } from 'react'
import { AlertCircle, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface MermaidErrorComponentProps {
  error: string
  chart: string
  retry: () => void
  messageId?: string
}

function MermaidErrorComponent({
  error,
  chart,
  retry,
}: MermaidErrorComponentProps) {
  const [showSource, setShowSource] = useState(false)

  return (
    <div className="my-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-destructive">
            Diagram failed to render
          </p>
          <p className="mt-1 font-mono text-xs text-muted-foreground break-all">
            {error}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={retry}
              className="h-7 gap-1.5 text-xs"
            >
              <RefreshCw size={12} />
              Retry
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowSource((s) => !s)}
              className={cn('h-7 gap-1.5 text-xs text-muted-foreground')}
            >
              {showSource ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {showSource ? 'Hide source' : 'Show source'}
            </Button>
          </div>
          {showSource && (
            <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs text-foreground">
              {chart}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}

export const MermaidError = memo(MermaidErrorComponent)
