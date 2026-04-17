import { ChevronDown, ChevronRight, Clock, Coins } from "lucide-react";
import { memo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { RunLogData, RunLogStep } from '@/lib/multi-agent/run-log'

type RunLogSummaryProps = {
  runLog: RunLogData
}

export const RunLogSummary = memo(function RunLogSummary({
  runLog,
}: RunLogSummaryProps) {
  const [detailsOpen, setDetailsOpen] = useState(false)

  const durationMs = runLog.completed_at
    ? runLog.completed_at - runLog.started_at
    : 0
  const durationSec = (durationMs / 1000).toFixed(1)
  const agentCount = new Set(runLog.steps.map((s) => s.agent_id)).size

  return (
    <>
      <button
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1 mb-2"
        onClick={() => setDetailsOpen(true)}
      >
        <Coins size={12} />
        <span>
          {agentCount} agent{agentCount !== 1 ? 's' : ''} &middot;{' '}
          {runLog.total_tokens.toLocaleString()} tokens &middot; {durationSec}s
        </span>
        <span className="underline">Details</span>
      </button>

      <RunLogViewerDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        runLog={runLog}
      />
    </>
  )
})

type RunLogViewerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  runLog: RunLogData
}

function RunLogViewerDialog({
  open,
  onOpenChange,
  runLog,
}: RunLogViewerDialogProps) {
  const durationMs = runLog.completed_at
    ? runLog.completed_at - runLog.started_at
    : 0

  const statusColor =
    runLog.status === 'completed'
      ? 'text-green-500'
      : runLog.status === 'failed'
        ? 'text-red-500'
        : 'text-blue-500'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Run Log</DialogTitle>
        </DialogHeader>

        {/* Summary */}
        <div className="grid grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Status</p>
            <p className={cn('font-medium', statusColor)}>{runLog.status}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Tokens</p>
            <p className="font-medium">
              {runLog.total_tokens.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Duration</p>
            <p className="font-medium">{(durationMs / 1000).toFixed(1)}s</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Orchestrator</p>
            <p className="font-medium">
              {runLog.orchestrator_tokens.toLocaleString()} tokens
            </p>
          </div>
        </div>

        {/* Token breakdown bar */}
        <div className="space-y-1">
          <p className="text-xs font-medium">Token Breakdown</p>
          <div className="flex h-4 rounded-full overflow-hidden bg-muted">
            {runLog.total_tokens > 0 && (
              <>
                <div
                  className="bg-blue-500/60 h-full"
                  style={{
                    width: `${(runLog.orchestrator_tokens / runLog.total_tokens) * 100}%`,
                  }}
                  title={`Orchestrator: ${runLog.orchestrator_tokens.toLocaleString()}`}
                />
                {runLog.steps
                  .filter((s) => s.status === 'complete')
                  .map((step, i) => (
                    <div
                      key={`${step.agent_id}-${i}`}
                      className={cn(
                        'h-full',
                        i % 3 === 0
                          ? 'bg-green-500/60'
                          : i % 3 === 1
                            ? 'bg-purple-500/60'
                            : 'bg-amber-500/60'
                      )}
                      style={{
                        width: `${(step.tokens_used / runLog.total_tokens) * 100}%`,
                      }}
                      title={`${step.agent_name}: ${step.tokens_used.toLocaleString()}`}
                    />
                  ))}
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-blue-500/60" />
              Orchestrator
            </span>
            {runLog.steps
              .filter((s) => s.status === 'complete')
              .map((step, i) => (
                <span
                  key={`${step.agent_id}-legend-${i}`}
                  className="flex items-center gap-1"
                >
                  <span
                    className={cn(
                      'size-2 rounded-full',
                      i % 3 === 0
                        ? 'bg-green-500/60'
                        : i % 3 === 1
                          ? 'bg-purple-500/60'
                          : 'bg-amber-500/60'
                    )}
                  />
                  {step.agent_name}
                </span>
              ))}
          </div>
        </div>

        {/* Step timeline */}
        <div className="space-y-1">
          <p className="text-xs font-medium">Agent Steps</p>
          <div className="space-y-1">
            {runLog.steps.map((step, i) => (
              <StepRow key={`${step.agent_id}-${i}`} step={step} index={i} />
            ))}
          </div>
        </div>

        {/* Error */}
        {runLog.error && (
          <div className="text-xs text-red-500 bg-red-500/5 rounded p-2">
            {runLog.error}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function StepRow({ step, index }: { step: RunLogStep; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const hasToolCalls = step.tool_calls && step.tool_calls.length > 0

  return (
    <div className="rounded border border-border/40 bg-muted/30 text-xs">
      <button
        className="flex items-center gap-2 w-full p-2 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-muted-foreground w-4">{index + 1}.</span>
        {hasToolCalls ? (
          expanded ? (
            <ChevronDown size={12} />
          ) : (
            <ChevronRight size={12} />
          )
        ) : (
          <span className="w-3" />
        )}
        <span className="font-medium">{step.agent_name}</span>
        {step.agent_role && (
          <span className="text-muted-foreground">({step.agent_role})</span>
        )}
        <span className="ml-auto flex items-center gap-2 text-muted-foreground">
          {step.status === 'error' ? (
            <span className="text-red-500">Error</span>
          ) : (
            <>
              <span>{step.tokens_used.toLocaleString()} tok</span>
              <span className="flex items-center gap-0.5">
                <Clock size={10} />
                {((step.duration_ms ?? 0) / 1000).toFixed(1)}s
              </span>
            </>
          )}
        </span>
      </button>

      {expanded && (
        <div className="px-2 pb-2 pl-8 space-y-1">
          {step.error && (
            <div className="text-red-500 bg-red-500/5 rounded p-1.5">
              {step.error}
            </div>
          )}
          {step.tool_calls?.map((tc, j) => (
            <div
              key={j}
              className="font-mono bg-muted/50 rounded px-2 py-1 border border-border/30"
            >
              <span className="font-medium">{tc.name}</span>
              <pre className="text-muted-foreground whitespace-pre-wrap break-all mt-0.5">
                {typeof tc.args === 'string'
                  ? tc.args.slice(0, 300)
                  : JSON.stringify(tc.args ?? {}, null, 2).slice(0, 300)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
