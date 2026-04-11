import { useState, useCallback } from 'react'
import { SMART_START_WORKFLOWS, type SmartStartWorkflow } from '@/lib/smart-start/workflows'
import { WorkflowForm } from './WorkflowForm'

const colorMap: Record<string, string> = {
  violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 hover:bg-violet-500/20',
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20',
  cyan: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/20',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20',
  rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20',
  indigo: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20',
}

interface WorkflowSelectorProps {
  onPromptReady: (prompt: string) => void
}

export function WorkflowSelector({ onPromptReady }: WorkflowSelectorProps) {
  const [activeWorkflow, setActiveWorkflow] = useState<SmartStartWorkflow | null>(null)

  const handleSelect = useCallback((workflow: SmartStartWorkflow) => {
    setActiveWorkflow(workflow)
  }, [])

  const handleSubmit = useCallback(
    (prompt: string) => {
      setActiveWorkflow(null)
      onPromptReady(prompt)
    },
    [onPromptReady]
  )

  const handleCancel = useCallback(() => {
    setActiveWorkflow(null)
  }, [])

  // Show the form when a workflow is selected
  if (activeWorkflow) {
    return (
      <WorkflowForm
        workflow={activeWorkflow}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    )
  }

  // Show the workflow grid
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 w-full max-w-xl mx-auto">
      {SMART_START_WORKFLOWS.map((workflow) => {
        const colors = colorMap[workflow.color] ?? colorMap.violet
        return (
          <button
            key={workflow.id}
            onClick={() => handleSelect(workflow)}
            className={`flex flex-col items-start gap-1.5 px-3.5 py-3 rounded-xl border border-border/50 transition-all duration-150 ${colors}`}
            type="button"
          >
            <div className="flex items-center gap-2">
              <workflow.icon className="size-4" />
              <span className="text-xs font-semibold uppercase tracking-wide opacity-70">
                {workflow.tag}
              </span>
            </div>
            <span className="text-sm font-medium text-foreground leading-snug text-left">
              {workflow.label}
            </span>
            <span className="text-[11px] text-muted-foreground leading-snug text-left">
              {workflow.description}
            </span>
          </button>
        )
      })}
    </div>
  )
}
