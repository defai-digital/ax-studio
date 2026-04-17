import { Check, ChevronDown, ChevronRight, Loader2, X } from "lucide-react";
import { memo, useState } from 'react'
import { cn } from '@/lib/utils'
type AgentOutputCardProps = {
  agentName: string
  agentRole?: string
  status: 'running' | 'complete' | 'error'
  tokensUsed: number
  toolCalls?: Array<{ name: string; args: unknown }>
  error?: string
  output?: string
  isCollapsed?: boolean
}

const statusConfig = {
  running: {
    color: 'text-blue-500',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    label: 'Running',
  },
  complete: {
    color: 'text-green-500',
    bg: 'bg-green-500/10',
    border: 'border-green-500/20',
    label: 'Complete',
  },
  error: {
    color: 'text-red-500',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    label: 'Error',
  },
}

const StatusIcon = ({ status }: { status: 'running' | 'complete' | 'error' }) => {
  switch (status) {
    case 'running':
      return <Loader2 size={14} className="text-blue-500 animate-spin" />
    case 'complete':
      return <Check size={14} className="text-green-500" />
    case 'error':
      return <X size={14} className="text-red-500" />
  }
}

export const AgentOutputCard = memo(function AgentOutputCard({
  agentName,
  agentRole,
  status,
  tokensUsed,
  toolCalls,
  error,
  output,
  isCollapsed: defaultCollapsed = false,
}: AgentOutputCardProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)
  const [toolCallsExpanded, setToolCallsExpanded] = useState(false)
  const [outputExpanded, setOutputExpanded] = useState(false)
  const config = statusConfig[status]

  const hasDetails =
    error || (toolCalls && toolCalls.length > 0) || output

  return (
    <div
      className={cn(
        'rounded-lg border p-3 mb-2',
        config.border,
        config.bg
      )}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 cursor-pointer select-none"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        {/* Expand/collapse icon */}
        {hasDetails ? (
          isCollapsed ? (
            <ChevronRight size={14} className="text-muted-foreground" />
          ) : (
            <ChevronDown size={14} className="text-muted-foreground" />
          )
        ) : (
          <div className="w-3.5" />
        )}

        {/* Status icon */}
        <StatusIcon status={status} />

        {/* Agent name + role */}
        <span className="text-sm font-medium">{agentName}</span>
        {agentRole && (
          <span className="text-xs text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
            {agentRole}
          </span>
        )}

        {/* Token count */}
        {tokensUsed > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">
            {tokensUsed.toLocaleString()} tokens
          </span>
        )}

        {/* Tool call count */}
        {toolCalls && toolCalls.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {toolCalls.length} tool call{toolCalls.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Expanded content */}
      {!isCollapsed && hasDetails && (
        <div className="mt-2 pl-5 space-y-2">
          {/* Error message */}
          {error && (
            <div className="text-xs text-red-500 bg-red-500/5 rounded p-2">
              {error}
            </div>
          )}

          {/* Tool calls */}
          {toolCalls && toolCalls.length > 0 && (
            <div>
              <button
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground mb-1 hover:text-foreground transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  setToolCallsExpanded(!toolCallsExpanded)
                }}
              >
                {toolCallsExpanded ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
                Tools used ({toolCalls.length})
              </button>
              {toolCallsExpanded && (
                <div className="space-y-1 ml-3">
                  {toolCalls.map((tc, i) => {
                    const argsStr =
                      typeof tc.args === 'string'
                        ? tc.args
                        : JSON.stringify(tc.args ?? {}, null, 2)
                    const isLong = argsStr.length > 200
                    return (
                      <div
                        key={i}
                        className="text-xs font-mono bg-muted/50 rounded px-2 py-1.5 border border-border/30"
                      >
                        <div className="font-medium text-foreground mb-0.5">
                          {tc.name}
                        </div>
                        <pre className="text-muted-foreground whitespace-pre-wrap break-all">
                          {isLong ? argsStr.slice(0, 200) + '...' : argsStr}
                        </pre>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Agent output text */}
          {output && (
            <div>
              <button
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground mb-1 hover:text-foreground transition-colors"
                onClick={(e) => {
                  e.stopPropagation()
                  setOutputExpanded(!outputExpanded)
                }}
              >
                {outputExpanded ? (
                  <ChevronDown size={12} />
                ) : (
                  <ChevronRight size={12} />
                )}
                Agent output
              </button>
              {outputExpanded && (
                <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2 border border-border/30 max-h-60 overflow-y-auto whitespace-pre-wrap">
                  {output}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
})

AgentOutputCard.displayName = 'AgentOutputCard'
