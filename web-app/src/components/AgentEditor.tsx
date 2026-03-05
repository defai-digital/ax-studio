import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useModelProvider } from '@/hooks/useModelProvider'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  agent: Assistant | null
  onSave: (agent: Assistant) => void
  onDelete?: () => void
}

type ToolScopeMode = 'all' | 'include' | 'exclude'

export function AgentEditor({
  open,
  onOpenChange,
  agent,
  onSave,
  onDelete,
}: Props) {
  const { providers } = useModelProvider()

  // Form state
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [goal, setGoal] = useState('')
  const [avatar, setAvatar] = useState('')
  const [instructions, setInstructions] = useState('')
  const [description, setDescription] = useState('')
  const [modelOverrideId, setModelOverrideId] = useState('')
  const [toolScopeMode, setToolScopeMode] = useState<ToolScopeMode>('all')
  const [toolKeys, setToolKeys] = useState('')
  const [maxSteps, setMaxSteps] = useState(10)
  const [maxResultTokens, setMaxResultTokens] = useState(4000)
  const [totalTimeoutMs, setTotalTimeoutMs] = useState<number | undefined>()
  const [stepTimeoutMs, setStepTimeoutMs] = useState<number | undefined>()
  const [temperature, setTemperature] = useState<number | undefined>()
  const [topP, setTopP] = useState<number | undefined>()
  const [isOptional, setIsOptional] = useState(false)

  useEffect(() => {
    if (agent) {
      setName(agent.name)
      setRole(agent.role ?? '')
      setGoal(agent.goal ?? '')
      setAvatar(agent.avatar ?? '')
      setInstructions(agent.instructions ?? '')
      setDescription(agent.description ?? '')
      setModelOverrideId(agent.model_override_id ?? '')
      setToolScopeMode(agent.tool_scope?.mode ?? 'all')
      setToolKeys(agent.tool_scope?.tool_keys?.join(', ') ?? '')
      setMaxSteps(agent.max_steps ?? 10)
      setMaxResultTokens(agent.max_result_tokens ?? 4000)
      setTotalTimeoutMs(agent.timeout?.total_ms)
      setStepTimeoutMs(agent.timeout?.step_ms)
      setTemperature(
        agent.parameters?.temperature as number | undefined
      )
      setTopP(agent.parameters?.top_p as number | undefined)
      setIsOptional(agent.optional ?? false)
    } else {
      setName('')
      setRole('')
      setGoal('')
      setAvatar('')
      setInstructions('')
      setDescription('')
      setModelOverrideId('')
      setToolScopeMode('all')
      setToolKeys('')
      setMaxSteps(10)
      setMaxResultTokens(4000)
      setTotalTimeoutMs(undefined)
      setStepTimeoutMs(undefined)
      setTemperature(undefined)
      setTopP(undefined)
      setIsOptional(false)
    }
  }, [agent, open])

  const handleSave = () => {
    if (!name.trim()) return

    const toolScope =
      toolScopeMode === 'all'
        ? undefined
        : {
            mode: toolScopeMode,
            tool_keys: toolKeys
              .split(',')
              .map((k) => k.trim())
              .filter(Boolean),
          }

    const timeout =
      totalTimeoutMs || stepTimeoutMs
        ? {
            total_ms: totalTimeoutMs,
            step_ms: stepTimeoutMs,
          }
        : undefined

    const parameters: Record<string, unknown> = {}
    if (temperature !== undefined) parameters.temperature = temperature
    if (topP !== undefined) parameters.top_p = topP

    const result: Assistant = {
      id: agent?.id ?? crypto.randomUUID(),
      name: name.trim(),
      avatar: avatar || undefined,
      created_at: agent?.created_at ?? Date.now(),
      description: description.trim() || undefined,
      instructions: instructions.trim(),
      parameters,
      type: 'agent',
      role: role.trim() || undefined,
      goal: goal.trim() || undefined,
      model_override_id: modelOverrideId || undefined,
      tool_scope: toolScope,
      max_steps: maxSteps,
      timeout,
      max_result_tokens: maxResultTokens,
      optional: isOptional || undefined,
    }

    onSave(result)
  }

  const allModels = providers.flatMap((p) =>
    p.models?.map((m) => ({ ...m, provider: p.provider })) ?? []
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{agent ? 'Edit Agent' : 'Create Agent'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Name, Role, Goal */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Researcher"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Role</label>
              <Input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Senior Research Analyst"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Goal</label>
              <Input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="What this agent optimizes for"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Avatar (emoji)</label>
              <Input
                value={avatar}
                onChange={(e) => setAvatar(e.target.value)}
                placeholder="e.g. 🔍"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description of this agent's capabilities"
            />
          </div>

          {/* System Prompt */}
          <div className="space-y-2">
            <label className="text-sm font-medium">System Prompt</label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Instructions for this agent..."
              className="min-h-32"
            />
          </div>

          {/* Model Override */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Model Override (optional)
            </label>
            <select
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={modelOverrideId}
              onChange={(e) => setModelOverrideId(e.target.value)}
            >
              <option value="">Default (use team&apos;s model)</option>
              {allModels.map((m) => (
                <option key={`${m.provider}-${m.id}`} value={m.id}>
                  {m.id} ({m.provider})
                </option>
              ))}
            </select>
          </div>

          {/* Tool Access */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Tool Access</label>
            <div className="flex gap-2">
              {(['all', 'include', 'exclude'] as ToolScopeMode[]).map(
                (scopeMode) => (
                  <button
                    key={scopeMode}
                    className={`px-3 py-1.5 rounded-md border text-sm transition-colors ${
                      toolScopeMode === scopeMode
                        ? 'border-foreground/40 bg-secondary'
                        : 'border-border hover:bg-secondary/50'
                    }`}
                    onClick={() => setToolScopeMode(scopeMode)}
                  >
                    {scopeMode === 'all'
                      ? 'All Tools'
                      : scopeMode === 'include'
                        ? 'Only Selected'
                        : 'All Except'}
                  </button>
                )
              )}
            </div>
            {toolScopeMode !== 'all' && (
              <div className="space-y-1">
                <Input
                  value={toolKeys}
                  onChange={(e) => setToolKeys(e.target.value)}
                  placeholder="server::tool, server::tool2 (comma-separated)"
                />
                <p className="text-xs text-muted-foreground">
                  Tool key format: server::toolName (e.g. exa::search)
                </p>
              </div>
            )}
          </div>

          {/* Limits */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Max Steps</label>
              <Input
                type="number"
                min={1}
                max={50}
                value={maxSteps}
                onChange={(e) => setMaxSteps(parseInt(e.target.value) || 10)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Max Result Tokens</label>
              <Input
                type="number"
                min={100}
                value={maxResultTokens}
                onChange={(e) =>
                  setMaxResultTokens(parseInt(e.target.value) || 4000)
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Total Timeout (ms)
              </label>
              <Input
                type="number"
                min={0}
                value={totalTimeoutMs ?? ''}
                onChange={(e) =>
                  setTotalTimeoutMs(
                    e.target.value ? parseInt(e.target.value) : undefined
                  )
                }
                placeholder="Optional"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Per-Step Timeout (ms)
              </label>
              <Input
                type="number"
                min={0}
                value={stepTimeoutMs ?? ''}
                onChange={(e) =>
                  setStepTimeoutMs(
                    e.target.value ? parseInt(e.target.value) : undefined
                  )
                }
                placeholder="Optional"
              />
            </div>
          </div>

          {/* Inference Parameters */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Temperature</label>
              <Input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={temperature ?? ''}
                onChange={(e) =>
                  setTemperature(
                    e.target.value ? parseFloat(e.target.value) : undefined
                  )
                }
                placeholder="Default"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Top P</label>
              <Input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={topP ?? ''}
                onChange={(e) =>
                  setTopP(
                    e.target.value ? parseFloat(e.target.value) : undefined
                  )
                }
                placeholder="Default"
              />
            </div>
          </div>

          {/* Optional flag */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="agent-optional"
              checked={isOptional}
              onChange={(e) => setIsOptional(e.target.checked)}
              className="rounded"
            />
            <label htmlFor="agent-optional" className="text-sm">
              Optional agent (orchestrator may skip if not needed)
            </label>
          </div>
        </div>

        <DialogFooter>
          <div className="flex items-center gap-2 w-full">
            {onDelete && agent && (
              <Button
                variant="destructive"
                onClick={() => {
                  onDelete()
                  onOpenChange(false)
                }}
                className="mr-auto"
              >
                Delete Agent
              </Button>
            )}
            <div className="flex items-center gap-2 ml-auto">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={!name.trim()}>
                {agent ? 'Save Changes' : 'Create Agent'}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
