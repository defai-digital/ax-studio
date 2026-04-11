import { createFileRoute, useParams } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { useThreadManagement } from '@/hooks/threads/useThreadManagement'
import { useThreads } from '@/hooks/threads/useThreads'
import { useAssistant } from '@/hooks/chat/useAssistant'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { toast } from 'sonner'

import ChatInput from '@/containers/ChatInput'
import HeaderPage from '@/containers/HeaderPage'
import ThreadList from '@/containers/ThreadList'
import ProjectFiles from '@/containers/ProjectFiles'
import { AvatarEmoji } from '@/components/common/AvatarEmoji'

import {
  FolderOpen,
  FolderPenIcon,
  MessageCircle,
  MoreHorizontal,
  PencilIcon,
  Trash2,
} from 'lucide-react'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import AddProjectDialog from '@/containers/dialogs/AddProjectDialog'
import { DeleteProjectDialog } from '@/containers/dialogs/DeleteProjectDialog'
import { DeleteAllThreadsInProjectDialog } from '@/containers/dialogs/thread/DeleteAllThreadsInProjectDialog'
import { SidebarMenu } from '@/components/ui/sidebar'

export const Route = createFileRoute('/project/$projectId')({
  component: ProjectPageContent,
})

function ProjectPageContent() {
  const { t, i18n } = useTranslation()
  const { projectId } = useParams({ from: '/project/$projectId' })
  const { getFolderById, updateFolder } = useThreadManagement()
  const threads = useThreads((state) => state.threads)
  const deleteAllThreadsByProject = useThreads(
    (state) => state.deleteAllThreadsByProject,
  )
  const { assistants } = useAssistant()

  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  // Find the project
  const project = getFolderById(projectId)

  // Find the assigned assistant
  const projectAssistant = useMemo(() => {
    if (!project?.assistantId) return null
    return assistants.find((a) => a.id === project.assistantId) || null
  }, [project?.assistantId, assistants])

  // Get threads for this project
  const projectThreads = useMemo(() => {
    return Object.values(threads)
      .filter((thread) => thread.metadata?.project?.id === projectId)
      .sort((a, b) => (b.updated || 0) - (a.updated || 0))
  }, [threads, projectId])

  const handleSaveEdit = async (
    name: string,
    assistantId?: string,
    logo?: string,
    projectPrompt?: string | null,
  ) => {
    if (project) {
      try {
        await updateFolder(project.id, name, assistantId, logo, projectPrompt)
        setEditDialogOpen(false)
      } catch (error) {
        console.error('Failed to update project:', error)
        toast.error(
          error instanceof Error ? error.message : 'Failed to update project'
        )
      }
    }
  }

  const handleDeleteAllThreads = () => {
    deleteAllThreadsByProject(projectId)
  }

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold mb-2">
            {t('projects.projectNotFound')}
          </h1>
          <p className="text-muted-foreground">
            {t('projects.projectNotFoundDesc')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center justify-between w-full">
          <DropdownModelProvider />
        </div>
      </HeaderPage>

      {/* Project Header */}
      <div className="border-b border-border/50 bg-background px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center">
                {project.logo ? (
                  <img
                    src={project.logo}
                    alt={project.name}
                    className="size-6 rounded-md object-cover"
                  />
                ) : (
                  <FolderOpen className="size-5 text-primary" />
                )}
              </div>
              <div>
                <h1 style={{ fontSize: '20px', fontWeight: 600 }}>
                  {project.name}
                </h1>
                <div className="text-[12px] text-muted-foreground">
                  {projectThreads.length}{' '}
                  {projectThreads.length === 1
                    ? 'conversation'
                    : 'conversations'}
                </div>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditDialogOpen(true)}>
                  <FolderPenIcon className="size-4" />
                  <span>{t('projects.editProject')}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 className="size-4" />
                  <span>{t('projects.deleteProject')}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Content */}
      <div
        className="flex-1 overflow-y-auto px-6 py-6"
        style={{ scrollbarWidth: 'thin' }}
      >
        <div className="max-w-3xl mx-auto space-y-8">
          {/* Chat Input */}
          <ChatInput
            showSpeedToken={false}
            initialMessage={true}
            projectId={projectId}
          />

          {/* Conversations */}
          {projectThreads.length > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 style={{ fontSize: '15px', fontWeight: 600 }}>
                  Conversations
                </h2>
                <DropdownMenu
                  open={dropdownOpen}
                  onOpenChange={setDropdownOpen}
                >
                  <DropdownMenuTrigger asChild>
                    <button className="text-muted-foreground hover:text-foreground transition-colors">
                      <MoreHorizontal className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="right" align="start">
                    <DeleteAllThreadsInProjectDialog
                      projectName={project.name}
                      threadCount={projectThreads.length}
                      onDeleteAll={handleDeleteAllThreads}
                      onDropdownClose={() => setDropdownOpen(false)}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <SidebarMenu className="gap-2">
                <ThreadList
                  threads={projectThreads}
                  currentProjectId={projectId}
                />
              </SidebarMenu>
            </div>
          ) : (
            /* Empty State */
            <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-border/50">
              <MessageCircle className="size-8 text-muted-foreground/30 mb-3" />
              <h3
                style={{ fontSize: '15px', fontWeight: 500 }}
                className="text-foreground mb-1"
              >
                {t('projects.noConversationsIn', {
                  projectName: project.name,
                })}
              </h3>
              <p className="text-[12px] text-muted-foreground">
                {t('projects.startNewConversation', {
                  projectName: project.name,
                })}
              </p>
            </div>
          )}

          {/* Project Settings */}
          <div>
            <h2
              style={{ fontSize: '15px', fontWeight: 600 }}
              className="mb-3"
            >
              {t('projects.addProjectDialog.settings', {
                defaultValue: 'Project Settings',
              })}
            </h2>

            {/* Assistant Card */}
            <div className="rounded-xl border border-border/50 p-4 mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="size-9 rounded-lg bg-muted flex items-center justify-center">
                    {projectAssistant?.avatar ? (
                      <AvatarEmoji
                        avatar={projectAssistant.avatar}
                        imageClassName="w-5 h-5 object-contain"
                        textClassName="text-base"
                      />
                    ) : (
                      <span className="text-lg">🤖</span>
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 500 }}>
                      {projectAssistant?.name ||
                        t('projects.noAssistantAssigned')}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {projectAssistant
                        ? t('projects.addProjectDialog.assistant')
                        : t('projects.noAssistantAssigned')}
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditDialogOpen(true)}
                >
                  {t('common:change', { defaultValue: 'Change' })}
                </Button>
              </div>
            </div>

            {/* System Prompt Card */}
            <div className="rounded-xl border border-border/50 p-4 mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 500 }}>
                    System Prompt
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {project.projectPrompt?.trim()
                      ? 'Using Project Prompt'
                      : 'Inheriting from Global'}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditDialogOpen(true)}
                >
                  <PencilIcon className="size-3" />
                  <span>{t('common:edit')}</span>
                </Button>
              </div>
            </div>

            {/* Project Files Card */}
            <div className="rounded-xl border border-border/50 overflow-hidden">
              <ProjectFiles projectId={projectId} lng={i18n.language} />
            </div>
          </div>
        </div>
      </div>

      <AddProjectDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        editingKey={project.id}
        initialData={project}
        onSave={handleSaveEdit}
      />

      <DeleteProjectDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        projectId={project.id}
        projectName={project.name}
      />
    </div>
  )
}
