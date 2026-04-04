import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useState, useEffect } from 'react'

import { useAgentTeamStore } from '@/stores/agent-team-store'
import { useAssistant } from '@/hooks/useAssistant'

import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  IconCirclePlus,
  IconPencil,
  IconTrash,
  IconTemplate,
  IconCopy,
  IconDownload,
  IconUpload,
} from '@tabler/icons-react'
import { Users } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { AgentTeamBuilder } from '@/components/AgentTeamBuilder'
import { TEMPLATES } from '@/lib/multi-agent/templates'
import type { AgentTeam } from '@/types/agent-team'
import type { TeamTemplate } from '@/lib/multi-agent/templates'
import { estimateTeamRunCost } from '@/lib/multi-agent/cost-estimation'

export const Route = createFileRoute(route.settings.agent_teams)({
  component: AgentTeamsContent,
})

const ORCHESTRATION_LABELS: Record<string, string> = {
  'router': 'Router',
  'sequential': 'Sequential',
  'parallel': 'Parallel',
  'evaluator-optimizer': 'Evaluator-Optimizer',
}

function AgentTeamsContent() {
  const { t } = useTranslation()
  const {
    teams,
    isLoaded,
    loadTeams,
    createTeam,
    updateTeam,
    deleteTeam,
    exportTeam,
    importTeam,
  } = useAgentTeamStore()
  const { assistants, addAssistant } = useAssistant()

  const [editorOpen, setEditorOpen] = useState(false)
  const [editingTeam, setEditingTeam] = useState<AgentTeam | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [teamToDelete, setTeamToDelete] = useState<string | null>(null)
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false)

  useEffect(() => {
    if (!isLoaded) {
      loadTeams()
    }
  }, [isLoaded, loadTeams])

  const handleCreate = () => {
    setEditingTeam(null)
    setEditorOpen(true)
  }

  const handleEdit = (team: AgentTeam) => {
    setEditingTeam(team)
    setEditorOpen(true)
  }

  const handleDeleteClick = (teamId: string) => {
    setTeamToDelete(teamId)
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (teamToDelete) {
      await deleteTeam(teamToDelete)
      setDeleteDialogOpen(false)
      setTeamToDelete(null)
    }
  }

  const handleDuplicate = async (team: AgentTeam) => {
    await createTeam({
      name: `${team.name} (Copy)`,
      description: team.description,
      orchestration: team.orchestration,
      orchestrator_instructions: team.orchestrator_instructions,
      orchestrator_model_id: team.orchestrator_model_id,
      agent_ids: [...team.agent_ids],
      variables: team.variables,
      token_budget: team.token_budget,
      cost_approval_threshold: team.cost_approval_threshold,
      parallel_stagger_ms: team.parallel_stagger_ms,
    })
  }

  const handleSave = async (team: AgentTeam) => {
    if (editingTeam) {
      await updateTeam(team)
    } else {
      await createTeam(team)
    }
    setEditorOpen(false)
    setEditingTeam(null)
  }

  const handleImportTemplate = async (template: TeamTemplate) => {
    // Create agents from template definitions
    const agentIds: string[] = []
    for (const agentDef of template.agents) {
      const now = Date.now()
      const agent: Assistant = {
        id: crypto.randomUUID(),
        name: agentDef.name,
        avatar: '',
        created_at: now,
        description: agentDef.goal,
        instructions: agentDef.instructions,
        parameters: {},
        type: 'agent',
        role: agentDef.role,
        goal: agentDef.goal,
        tool_scope: agentDef.tool_scope,
        max_steps: agentDef.max_steps,
        max_result_tokens: agentDef.max_result_tokens,
        timeout: agentDef.timeout,
        optional: agentDef.optional,
      }
      addAssistant(agent)
      agentIds.push(agent.id)
    }

    // Create team with agent IDs
    await createTeam({
      name: template.name,
      description: template.description,
      orchestration: template.orchestration,
      orchestrator_instructions: template.orchestrator_instructions,
      agent_ids: agentIds,
      token_budget: template.token_budget,
      parallel_stagger_ms: template.parallel_stagger_ms,
    })

    setTemplateMenuOpen(false)
  }

  const handleExport = (teamId: string) => {
    const data = exportTeam(teamId, () => assistants)
    if (!data) return
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${data.team.name.replace(/[^a-zA-Z0-9]/g, '_')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportFile = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        if (!data.team || !data.agents) {
          throw new Error('Invalid team export format')
        }
        await importTeam(data, addAssistant)
      } catch {
        console.error('Failed to import team file')
      }
    }
    input.click()
  }

  const getAgentNames = (team: AgentTeam): string => {
    return team.agent_ids
      .map((id) => assistants.find((a) => a.id === id)?.name ?? 'Unknown')
      .join(', ')
  }

  const getEstimate = (team: AgentTeam) => {
    const teamAgents = team.agent_ids
      .map((id) => assistants.find((a) => a.id === id))
      .filter(Boolean) as Assistant[]
    if (teamAgents.length === 0) return null
    return estimateTeamRunCost(team, teamAgents)
  }

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div
          className={cn(
            'flex items-center justify-between w-full mr-2 pr-3',
            !IS_MACOS && 'pr-30'
          )}
        >
          <span className="font-medium text-base font-studio">Settings</span>
          <div className="flex items-center gap-2 relative z-50">
            <Button onClick={handleImportFile} size="sm" variant="outline">
              <IconUpload size={16} />
              Import
            </Button>
            <Button
              onClick={() => setTemplateMenuOpen(true)}
              size="sm"
              variant="outline"
            >
              <IconTemplate size={16} />
              Template
            </Button>
            <Button onClick={handleCreate} size="sm" variant="outline">
              <IconCirclePlus size={16} />
              Create Team
            </Button>
          </div>
        </div>
      </HeaderPage>
      <div className="flex flex-1 min-h-0">
        <div className="flex h-svh w-full">
          <SettingsMenu />
          <div
            className="flex-1 overflow-y-auto"
            style={{ scrollbarWidth: 'none' }}
          >
            <div className="flex items-center gap-3 px-8 py-5 border-b border-border/40 bg-background sticky top-0 z-10">
              <div
                className="size-7 rounded-lg flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                }}
              >
                <Users className="size-3.5 text-white" strokeWidth={2.5} />
              </div>
              <h1
                className="text-foreground tracking-tight"
                style={{ fontSize: '16px', fontWeight: 600 }}
              >
                {t('common:agentTeams')}
              </h1>
            </div>
            <div className="px-8 py-7">
              <div className="max-w-2xl space-y-6">
                {!isLoaded ? (
                  <div className="text-muted-foreground text-sm p-4">
                    Loading teams...
                  </div>
                ) : teams.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="text-base font-medium mb-2">
                      No agent teams yet
                    </p>
                    <p className="text-sm">
                      Create a team or import a template to get started.
                    </p>
                  </div>
                ) : (
                  teams.map((team) => {
                    const estimate = getEstimate(team)
                    return (
                      <div
                        className="bg-secondary dark:bg-secondary/20 p-4 rounded-lg"
                        key={team.id}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="text-base font-studio font-medium line-clamp-1">
                                {team.name}
                              </h3>
                              <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                {ORCHESTRATION_LABELS[
                                  team.orchestration.mode
                                ] ?? team.orchestration.mode}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {team.agent_ids.length} agent
                                {team.agent_ids.length !== 1 ? 's' : ''}
                              </span>
                            </div>
                            <p className="text-muted-foreground text-xs line-clamp-2 mb-1">
                              {team.description}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              Agents: {getAgentNames(team)}
                            </p>
                            {estimate && (
                              <p className="text-muted-foreground text-xs mt-1">
                                Est. tokens:{' '}
                                {estimate.range.min.toLocaleString()}&ndash;
                                {estimate.range.max.toLocaleString()}
                                {team.token_budget && (
                                  <span>
                                    {' '}
                                    / {team.token_budget.toLocaleString()}{' '}
                                    budget
                                  </span>
                                )}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="Export team"
                              onClick={() => handleExport(team.id)}
                            >
                              <IconDownload className="text-muted-foreground size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="Duplicate team"
                              onClick={() => handleDuplicate(team)}
                            >
                              <IconCopy className="text-muted-foreground size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="Edit team"
                              onClick={() => handleEdit(team)}
                            >
                              <IconPencil className="text-muted-foreground size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title="Delete team"
                              onClick={() => handleDeleteClick(team.id)}
                            >
                              <IconTrash className="text-destructive size-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>

          {/* Team Editor */}
          {editorOpen && (
            <AgentTeamBuilder
              open={editorOpen}
              onOpenChange={setEditorOpen}
              team={editingTeam}
              onSave={handleSave}
            />
          )}

          {/* Delete Confirmation */}
          <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete Agent Team</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete this agent team? The agents
                  themselves will not be deleted.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDeleteDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleConfirmDelete}>
                  Delete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Template Import Dialog */}
          <Dialog open={templateMenuOpen} onOpenChange={setTemplateMenuOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Import Template</DialogTitle>
                <DialogDescription>
                  Choose a pre-built team template. Agents will be created
                  automatically.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {TEMPLATES.map((template) => (
                  <button
                    key={template.name}
                    className="w-full text-left p-3 rounded-lg border hover:bg-secondary/50 transition-colors"
                    onClick={() => handleImportTemplate(template)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">
                        {template.name}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {ORCHESTRATION_LABELS[template.orchestration.mode]}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {template.agents.length} agents
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {template.description}
                    </p>
                  </button>
                ))}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  )
}
