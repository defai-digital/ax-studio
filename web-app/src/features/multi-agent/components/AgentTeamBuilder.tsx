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
import { useAssistant } from '@/features/assistants/hooks/useAssistant'
import { useModelProvider } from '@/features/models/hooks/useModelProvider'
import { estimateTeamRunCost } from '@/features/multi-agent/lib/cost-estimation'
import { AgentEditor } from '@/features/multi-agent/components/AgentEditor'
import type { AgentTeam, OrchestrationType, TeamVariable } from '@/types/agent-team'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  IconCirclePlus,
  IconPencil,
  IconTrash,
  IconGripVertical,
  IconChevronUp,
  IconChevronDown,
} from '@tabler/icons-react'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  team: AgentTeam | null
  onSave: (team: AgentTeam) => void
}

const MODES: Array<{ value: OrchestrationType['mode']; label: string; description: string }> = [
  { value: 'router', label: 'Router', description: 'Routes each request to the best-matching agent' },
  { value: 'sequential', label: 'Sequential', description: 'Runs agents in order, chaining context' },
  { value: 'parallel', label: 'Parallel', description: 'Runs all agents concurrently, synthesizes results' },
  { value: 'evaluator-optimizer', label: 'Evaluator-Optimizer', description: 'Iteratively refines output with feedback' },
]

export function AgentTeamBuilder({ open, onOpenChange, team, onSave }: Props) {
  const { assistants, addAssistant, updateAssistant } =
    useAssistant()
  const { providers } = useModelProvider()

  // Form state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [mode, setMode] = useState<OrchestrationType['mode']>('router')
  const [maxIterations, setMaxIterations] = useState(3)
  const [qualityThreshold, setQualityThreshold] = useState('')
  const [orchestratorModelId, setOrchestratorModelId] = useState('')
  const [tokenBudget, setTokenBudget] = useState(100000)
  const [costApprovalThreshold, setCostApprovalThreshold] = useState<number | undefined>()
  const [parallelStaggerMs, setParallelStaggerMs] = useState(0)
  const [orchestratorInstructions, setOrchestratorInstructions] = useState('')
  const [agentIds, setAgentIds] = useState<string[]>([])
  const [variables, setVariables] = useState<TeamVariable[]>([])

  // Agent editor
  const [agentEditorOpen, setAgentEditorOpen] = useState(false)
  const [editingAgent, setEditingAgent] = useState<Assistant | null>(null)

  // Initialize from existing team
  useEffect(() => {
    if (team) {
      setName(team.name)
      setDescription(team.description)
      setMode(team.orchestration.mode)
      if (team.orchestration.mode === 'evaluator-optimizer') {
        setMaxIterations(team.orchestration.max_iterations ?? 3)
        setQualityThreshold(team.orchestration.quality_threshold ?? '')
      }
      setOrchestratorModelId(team.orchestrator_model_id ?? '')
      setTokenBudget(team.token_budget ?? 100000)
      setCostApprovalThreshold(team.cost_approval_threshold)
      setParallelStaggerMs(team.parallel_stagger_ms ?? 0)
      setOrchestratorInstructions(team.orchestrator_instructions ?? '')
      setAgentIds(team.agent_ids)
      setVariables(team.variables ?? [])
    } else {
      setName('')
      setDescription('')
      setMode('router')
      setMaxIterations(3)
      setQualityThreshold('')
      setOrchestratorModelId('')
      setTokenBudget(100000)
      setCostApprovalThreshold(undefined)
      setParallelStaggerMs(0)
      setOrchestratorInstructions('')
      setAgentIds([])
      setVariables([])
    }
  }, [team, open])

  // Build orchestration object
  const buildOrchestration = (): OrchestrationType => {
    switch (mode) {
      case 'evaluator-optimizer':
        return {
          mode: 'evaluator-optimizer',
          max_iterations: maxIterations,
          quality_threshold: qualityThreshold || undefined,
        }
      case 'router':
        return { mode: 'router' }
      case 'sequential':
        return { mode: 'sequential' }
      case 'parallel':
        return { mode: 'parallel' }
    }
  }

  const handleSave = () => {
    if (!name.trim()) return

    const teamData: AgentTeam = {
      id: team?.id ?? crypto.randomUUID(),
      name: name.trim(),
      description: description.trim(),
      orchestration: buildOrchestration(),
      orchestrator_instructions: orchestratorInstructions || undefined,
      orchestrator_model_id: orchestratorModelId || undefined,
      agent_ids: agentIds,
      variables: variables.length > 0 ? variables : undefined,
      token_budget: tokenBudget,
      cost_approval_threshold: costApprovalThreshold,
      parallel_stagger_ms:
        mode === 'parallel' && parallelStaggerMs > 0
          ? parallelStaggerMs
          : undefined,
      created_at: team?.created_at ?? Date.now(),
      updated_at: Date.now(),
    }

    onSave(teamData)
  }

  const handleAddAgent = () => {
    setEditingAgent(null)
    setAgentEditorOpen(true)
  }

  const handleSelectExistingAgent = (agentId: string) => {
    if (!agentIds.includes(agentId)) {
      setAgentIds((ids) => [...ids, agentId])
    }
  }

  const availableAgents = assistants.filter(
    (a) => a.type === 'agent' && !agentIds.includes(a.id)
  )

  const handleEditAgent = (agentId: string) => {
    const agent = assistants.find((a) => a.id === agentId)
    if (agent) {
      setEditingAgent(agent)
      setAgentEditorOpen(true)
    }
  }

  const handleRemoveAgent = (agentId: string) => {
    setAgentIds((ids) => ids.filter((id) => id !== agentId))
  }

  const handleMoveAgent = (index: number, direction: 'up' | 'down') => {
    const newIds = [...agentIds]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= newIds.length) return
    ;[newIds[index], newIds[targetIndex]] = [newIds[targetIndex], newIds[index]]
    setAgentIds(newIds)
  }

  const handleAgentSave = (agent: Assistant) => {
    if (editingAgent) {
      updateAssistant(agent)
    } else {
      addAssistant(agent)
      setAgentIds((ids) => [...ids, agent.id])
    }
    setAgentEditorOpen(false)
    setEditingAgent(null)
  }

  const handleDeleteAgent = (agentId: string) => {
    // Only remove from team — don't delete the assistant itself.
    // The assistant may be used by other teams.
    setAgentIds((ids) => ids.filter((id) => id !== agentId))
  }

  // Add variable
  const handleAddVariable = () => {
    setVariables((v) => [
      ...v,
      { name: '', label: '', description: '', default_value: '' },
    ])
  }

  const handleUpdateVariable = (
    index: number,
    field: keyof TeamVariable,
    value: string
  ) => {
    setVariables((v) =>
      v.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    )
  }

  const handleRemoveVariable = (index: number) => {
    setVariables((v) => v.filter((_, i) => i !== index))
  }

  // Get all available models across providers
  const allModels = providers.flatMap((p) =>
    p.models?.map((m) => ({ ...m, provider: p.provider })) ?? []
  )

  // Cost estimate
  const teamAgents = agentIds
    .map((id) => assistants.find((a) => a.id === id))
    .filter(Boolean) as Assistant[]
  const estimate =
    teamAgents.length > 0
      ? estimateTeamRunCost(
          {
            orchestration: buildOrchestration(),
            token_budget: tokenBudget,
          } as AgentTeam,
          teamAgents
        )
      : null

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {team ? 'Edit Agent Team' : 'Create Agent Team'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Name & Description */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Agent Team"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this team does..."
              />
            </div>

            {/* Orchestration Mode */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Orchestration Mode</label>
              <div className="grid grid-cols-2 gap-2">
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    className={`text-left p-2 rounded-lg border text-sm transition-colors ${
                      mode === m.value
                        ? 'border-foreground/40 bg-secondary'
                        : 'border-border hover:bg-secondary/50'
                    }`}
                    onClick={() => setMode(m.value)}
                  >
                    <div className="font-medium">{m.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {m.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Evaluator-Optimizer specific fields */}
            {mode === 'evaluator-optimizer' && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Max Iterations</label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={maxIterations}
                    onChange={(e) =>
                      setMaxIterations(parseInt(e.target.value) || 3)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    Quality Threshold
                  </label>
                  <Input
                    value={qualityThreshold}
                    onChange={(e) => setQualityThreshold(e.target.value)}
                    placeholder="Describe quality criteria..."
                  />
                </div>
              </div>
            )}

            {/* Parallel stagger */}
            {mode === 'parallel' && (
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Stagger Delay (ms)
                </label>
                <Input
                  type="number"
                  min={0}
                  value={parallelStaggerMs}
                  onChange={(e) =>
                    setParallelStaggerMs(parseInt(e.target.value) || 0)
                  }
                  placeholder="0 (no delay)"
                />
                <p className="text-xs text-muted-foreground">
                  Delay between each agent launch to avoid rate limits.
                </p>
              </div>
            )}

            {/* Orchestrator Model */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Orchestrator Model (optional)
              </label>
              <select
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={orchestratorModelId}
                onChange={(e) => setOrchestratorModelId(e.target.value)}
              >
                <option value="">Default (same as thread model)</option>
                {allModels.map((m) => (
                  <option key={`${m.provider}-${m.id}`} value={m.id}>
                    {m.id} ({m.provider})
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Use a cheaper model for orchestrator routing decisions.
              </p>
            </div>

            {/* Token Budget */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">Token Budget</label>
                <Input
                  type="number"
                  min={1000}
                  value={tokenBudget}
                  onChange={(e) =>
                    setTokenBudget(parseInt(e.target.value) || 100000)
                  }
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Cost Approval Threshold
                </label>
                <Input
                  type="number"
                  min={0}
                  value={costApprovalThreshold ?? ''}
                  onChange={(e) =>
                    setCostApprovalThreshold(
                      e.target.value ? parseFloat(e.target.value) : undefined
                    )
                  }
                  placeholder="Optional"
                />
              </div>
            </div>

            {/* Agents */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Agents</label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline">
                      <IconCirclePlus size={14} />
                      Add Agent
                      <IconChevronDown size={14} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuItem onSelect={handleAddAgent}>
                      <IconCirclePlus size={14} />
                      Create New Agent
                    </DropdownMenuItem>
                    {availableAgents.length > 0 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Select Existing</DropdownMenuLabel>
                        {availableAgents.map((agent) => (
                          <DropdownMenuItem
                            key={agent.id}
                            onSelect={() => handleSelectExistingAgent(agent.id)}
                          >
                            <div className="flex flex-col">
                              <span className="text-sm">{agent.name}</span>
                              {agent.role && (
                                <span className="text-xs text-muted-foreground">
                                  {agent.role}
                                </span>
                              )}
                            </div>
                          </DropdownMenuItem>
                        ))}
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {agentIds.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">
                  No agents added yet. Click &quot;Add Agent&quot; to create
                  or select one.
                </p>
              ) : (
                <div className="space-y-1">
                  {agentIds.map((agentId, index) => {
                    const agent = assistants.find((a) => a.id === agentId)
                    if (!agent) return null
                    return (
                      <div
                        key={agentId}
                        className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 border border-border/40"
                      >
                        <IconGripVertical
                          size={14}
                          className="text-muted-foreground shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">
                              {agent.name}
                            </span>
                            {agent.role && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                {agent.role}
                              </span>
                            )}
                            {agent.model_override_id && (
                              <span className="text-xs text-muted-foreground">
                                [{agent.model_override_id}]
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => handleMoveAgent(index, 'up')}
                            disabled={index === 0}
                          >
                            <IconChevronUp size={12} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => handleMoveAgent(index, 'down')}
                            disabled={index === agentIds.length - 1}
                          >
                            <IconChevronDown size={12} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => handleEditAgent(agentId)}
                          >
                            <IconPencil size={12} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => handleRemoveAgent(agentId)}
                          >
                            <IconTrash
                              size={12}
                              className="text-destructive"
                            />
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Orchestrator Instructions */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Custom Orchestrator Instructions (optional)
              </label>
              <Textarea
                value={orchestratorInstructions}
                onChange={(e) => setOrchestratorInstructions(e.target.value)}
                placeholder="Additional instructions for the orchestrator..."
                className="min-h-20"
              />
            </div>

            {/* Variables */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">
                  Variables (optional)
                </label>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAddVariable}
                >
                  <IconCirclePlus size={14} />
                  Add Variable
                </Button>
              </div>
              {variables.map((v, i) => (
                <div key={i} className="grid grid-cols-4 gap-2 items-end">
                  <Input
                    placeholder="name"
                    value={v.name}
                    onChange={(e) =>
                      handleUpdateVariable(i, 'name', e.target.value)
                    }
                  />
                  <Input
                    placeholder="Label"
                    value={v.label}
                    onChange={(e) =>
                      handleUpdateVariable(i, 'label', e.target.value)
                    }
                  />
                  <Input
                    placeholder="Default value"
                    value={v.default_value ?? ''}
                    onChange={(e) =>
                      handleUpdateVariable(i, 'default_value', e.target.value)
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => handleRemoveVariable(i)}
                  >
                    <IconTrash size={14} className="text-destructive" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Cost Estimate */}
            {estimate && (
              <div className="p-3 rounded-lg bg-muted/50 border border-border/40">
                <p className="text-sm font-medium mb-1">Cost Estimate</p>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  {estimate.agents.map((a) => (
                    <div key={a.agent} className="flex justify-between">
                      <span>{a.agent}</span>
                      <span>
                        ~{a.estimatedTokens.toLocaleString()} tokens
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-border/40 pt-1 mt-1">
                    <span>Orchestrator overhead</span>
                    <span>
                      ~{estimate.orchestratorOverhead.toLocaleString()} tokens
                    </span>
                  </div>
                  <div className="flex justify-between font-medium text-foreground pt-1">
                    <span>Total range</span>
                    <span>
                      {estimate.range.min.toLocaleString()}&ndash;
                      {estimate.range.max.toLocaleString()} tokens
                    </span>
                  </div>
                  {!estimate.withinBudget && (
                    <p className="text-amber-500 mt-1">
                      Warning: Estimated max exceeds token budget.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!name.trim() || agentIds.length === 0}
            >
              {team ? 'Save Changes' : 'Create Team'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Agent Editor */}
      {agentEditorOpen && (
        <AgentEditor
          open={agentEditorOpen}
          onOpenChange={setAgentEditorOpen}
          agent={editingAgent}
          onSave={handleAgentSave}
          onDelete={
            editingAgent ? () => handleDeleteAgent(editingAgent.id) : undefined
          }
        />
      )}
    </>
  )
}
