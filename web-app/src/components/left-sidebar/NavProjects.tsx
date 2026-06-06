import {
  FolderEditIcon,
  FolderIcon,
  FolderOpenIcon,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useThreadManagement } from "@/features/threads/hooks/useThreadManagement"
import { Link, useNavigate } from "@tanstack/react-router"
import { useTranslation } from "@/i18n/react-i18next-compat"

import { useState } from "react"
import type { ThreadFolder } from "@/services/projects/types"
import AddProjectDialog from "@/containers/dialogs/AddProjectDialog"
import { DeleteProjectDialog } from "@/containers/dialogs/DeleteProjectDialog"
import { useProjectDialog } from "@/hooks/useProjectDialog"

function ProjectItem({
  item,
  isMobile,
  onEdit,
  onDelete,
}: {
  item: ThreadFolder
  isMobile: boolean
  onEdit: (project: ThreadFolder) => void
  onDelete: (project: ThreadFolder) => void
}) {

  const { t } = useTranslation()
  const navigate = useNavigate()
  const logo = item.logo?.trim()

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild>
        <Link
          to="/project/$projectId"
          params={{ projectId: item.id }}
        >
          {logo ? (
            <img
              src={logo}
              alt={item.name}
              className="size-4 rounded-sm object-cover"
            />
          ) : (
            <FolderIcon className="text-foreground/70" size={16} />
          )}
          <span>{item.name}</span>
        </Link>
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover className="hover:bg-sidebar-foreground/8">
            <MoreHorizontal />
            <span className="sr-only">More</span>
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-48"
          side={isMobile ? "bottom" : "right"}
          align={isMobile ? "end" : "start"}
        >
          <DropdownMenuItem onSelect={() => {
            navigate({ to: '/project/$projectId', params: { projectId: item.id } })
          }}>
            <FolderOpenIcon className="text-muted-foreground" />
            <span>{t('common:projects.viewProject')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onEdit(item)}>
            <FolderEditIcon className="text-muted-foreground" />
            <span>{t('common:projects.editProject')}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => onDelete(item)}>
            <Trash2 />
            <span>{t('common:projects.deleteProject')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

export function NavProjects() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { isMobile } = useSidebar()
  const { folders, addFolder, updateFolder } = useThreadManagement()
  const { open: createDialogOpen, setOpen: setCreateDialogOpen } = useProjectDialog()

  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [selectedProject, setSelectedProject] = useState<ThreadFolder | null>(null)

  const handleCreate = async (
    name: string,
    assistantId?: string,
    logo?: string,
    projectPrompt?: string | null
  ) => {
    const newProject = await addFolder(name, assistantId, logo, projectPrompt)
    setCreateDialogOpen(false)
    navigate({
      to: '/project/$projectId',
      params: { projectId: newProject.id },
    })
  }

  const handleEdit = (project: ThreadFolder) => {
    setSelectedProject(project)
    setEditDialogOpen(true)
  }

  const handleDelete = (project: ThreadFolder) => {
    setSelectedProject(project)
    setDeleteDialogOpen(true)
  }

  const handleSaveEdit = async (
    name: string,
    assistantId?: string,
    logo?: string,
    projectPrompt?: string | null
  ) => {
    if (selectedProject) {
      await updateFolder(
        selectedProject.id,
        name,
        assistantId,
        logo,
        projectPrompt
      )
      setEditDialogOpen(false)
      setSelectedProject(null)
    }
  }

  return (
    <>
      <SidebarGroup className="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>{t('common:projects.title')}</SidebarGroupLabel>
        <SidebarGroupAction
          className="hover:bg-sidebar-foreground/8"
          title={t('common:projects.new')}
          onClick={() => setCreateDialogOpen(true)}
        >
          <Plus className="text-muted-foreground" />
          <span className="sr-only">{t('common:projects.new')}</span>
        </SidebarGroupAction>
        <SidebarMenu>
          {folders.map((item) => (
            <ProjectItem
              key={item.id}
              item={item}
              isMobile={isMobile}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </SidebarMenu>
      </SidebarGroup>

      <AddProjectDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        editingKey={null}
        onSave={handleCreate}
      />

      <AddProjectDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        editingKey={selectedProject?.id ?? null}
        initialData={selectedProject ?? undefined}
        onSave={handleSaveEdit}
      />

      <DeleteProjectDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        projectId={selectedProject?.id}
        projectName={selectedProject?.name}
      />
    </>
  )
}
