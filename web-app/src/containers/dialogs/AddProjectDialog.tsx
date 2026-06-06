import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useThreadManagement } from '@/features/threads/hooks/useThreadManagement'
import { useAssistant } from '@/features/assistants/hooks/useAssistant'
import { AvatarEmoji } from '@/containers/AvatarEmoji'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { ChevronDown, Plus } from 'lucide-react'
import AddEditAssistant from '@/features/assistants/components/AddEditAssistant'

interface AddProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingKey: string | null
  initialData?: {
    id: string
    name: string
    updated_at: number
    assistantId?: string
    logo?: string
    projectPrompt?: string | null
  }
  onSave: (
    name: string,
    assistantId?: string,
    logo?: string,
    projectPrompt?: string | null
  ) => void
}

export default function AddProjectDialog({
  open,
  onOpenChange,
  editingKey,
  initialData,
  onSave,
}: AddProjectDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(initialData?.name || '')
  const [logo, setLogo] = useState(initialData?.logo || '')
  const [projectPrompt, setProjectPrompt] = useState(initialData?.projectPrompt || '')
  const [selectedAssistantId, setSelectedAssistantId] = useState<string | undefined>(initialData?.assistantId)
  const { folders } = useThreadManagement()
  const { assistants, addAssistant } = useAssistant()
  const [addAssistantDialogOpen, setAddAssistantDialogOpen] = useState(false)

  const selectedAssistant = assistants.find((a) => a.id === selectedAssistantId)

  const handleLogoFileChange = (file?: File) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setLogo(String(reader.result || ''))
    }
    reader.onerror = () => {
      toast.error(t('error'))
    }
    reader.readAsDataURL(file)
  }

  useEffect(() => {
    if (open) {
      setName(initialData?.name || '')
      setLogo(initialData?.logo || '')
      setProjectPrompt(initialData?.projectPrompt || '')
      setSelectedAssistantId(initialData?.assistantId)
    }
  }, [open, initialData])

  const handleSave = () => {
    if (!name.trim()) return

    const trimmedName = name.trim()
    const trimmedLogo = logo.trim()
    const trimmedProjectPrompt = projectPrompt.trim()

    // Check for duplicate names (excluding current project when editing)
    const isDuplicate = folders.some(
      (folder) =>
        folder.name.toLowerCase() === trimmedName.toLowerCase() &&
        folder.id !== editingKey
    )

    if (isDuplicate) {
      toast.warning(t('projects.addProjectDialog.alreadyExists', { projectName: trimmedName }))
      return
    }

    onSave(
      trimmedName,
      selectedAssistantId,
      trimmedLogo || undefined,
      trimmedProjectPrompt || null
    )

    // Show success message
    if (editingKey) {
      toast.success(t('projects.addProjectDialog.updateSuccess', { projectName: trimmedName }))
    } else {
      toast.success(t('projects.addProjectDialog.createSuccess', { projectName: trimmedName }))
    }
    setName('')
    setLogo('')
    setProjectPrompt('')
    setSelectedAssistantId(undefined)
  }

  const handleCancel = () => {
    onOpenChange(false)
    setName('')
    setLogo('')
    setProjectPrompt('')
    setSelectedAssistantId(undefined)
  }

  // Check if the button should be disabled
  const hasChanged = editingKey
    ? name.trim() !== initialData?.name ||
      selectedAssistantId !== initialData?.assistantId ||
      logo.trim() !== (initialData?.logo || '') ||
      projectPrompt.trim() !== (initialData?.projectPrompt || '')
    : true
  const isButtonDisabled = !name.trim() || (editingKey && !hasChanged)

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editingKey ? t('projects.addProjectDialog.editTitle') : t('projects.addProjectDialog.createTitle')}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('projects.addProjectDialog.namePlaceholder')}
              className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border/50 outline-none text-[14px] focus:border-primary/30 transition-colors"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isButtonDisabled) {
                  handleSave()
                }
              }}
            />
          </div>
          <div>
            <label className="text-[13px] text-muted-foreground mb-1.5 block">
              {t('projects.addProjectDialog.logoUrl', { defaultValue: 'Logo URL (optional)' })}
            </label>
            <Input
              value={logo}
              onChange={(e) => setLogo(e.target.value)}
              placeholder={t('projects.addProjectDialog.logoUrlPlaceholder', {
                defaultValue: 'https://example.com/logo.png',
              })}
              className="mt-1"
            />
            <Input
              type="file"
              accept="image/*"
              className="mt-2"
              onChange={(e) => handleLogoFileChange(e.target.files?.[0])}
            />
            {logo.trim() && (
              <img
                src={logo.trim()}
                alt={name.trim() || t('projects.projectName')}
                className="mt-2 size-10 rounded-md object-cover border"
              />
            )}
          </div>
          <div>
            <label className="text-[13px] text-muted-foreground mb-1.5 block">
              {t('projects.addProjectDialog.projectPromptLabel')}
            </label>
            <Textarea
              value={projectPrompt}
              onChange={(e) => setProjectPrompt(e.target.value)}
              className="min-h-24"
              placeholder={t('projects.addProjectDialog.projectPromptPlaceholder')}
            />
            <div className="mt-2 flex justify-end">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setProjectPrompt('')}
                disabled={!projectPrompt.trim()}
              >
                {t('projects.addProjectDialog.clearOverride')}
              </Button>
            </div>
          </div>
          <div>
            <label className="text-[13px] text-muted-foreground mb-1.5 block">
              {t('projects.addProjectDialog.assistant')}
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full justify-between rounded-md"
                >
                  {selectedAssistant ? (
                    <div className="flex items-center gap-2">
                      {selectedAssistant.avatar && (
                        <AvatarEmoji
                          avatar={selectedAssistant.avatar}
                          imageClassName="w-4 h-4 object-contain"
                          textClassName="text-sm"
                        />
                      )}
                      <span>{selectedAssistant.name}</span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">
                      {t('projects.addProjectDialog.selectAssistant')}
                    </span>
                  )}
                  <ChevronDown className="size-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
                <DropdownMenuItem
                  onSelect={() => setSelectedAssistantId(undefined)}
                >
                  <span className="text-muted-foreground">
                    {t('projects.addProjectDialog.noAssistant')}
                  </span>
                </DropdownMenuItem>
                {assistants.map((assistant) => (
                  <DropdownMenuItem
                    key={assistant.id}
                    onSelect={() => setSelectedAssistantId(assistant.id)}
                  >
                    <div className="flex items-center gap-2">
                      {assistant.avatar && (
                        <AvatarEmoji
                          avatar={assistant.avatar}
                          imageClassName="w-4 h-4 object-contain"
                          textClassName="text-sm"
                        />
                      )}
                      <span>{assistant.name}</span>
                    </div>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => setAddAssistantDialogOpen(true)}
                >
                  <div className="flex items-center gap-2">
                    <Plus className="size-4" />
                    <span>{t('projects.addProjectDialog.addAssistant')}</span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={handleCancel}>
            {t('cancel')}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={Boolean(isButtonDisabled)}>
            {editingKey ? t('projects.addProjectDialog.updateButton') : t('projects.addProjectDialog.createButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AddEditAssistant
      open={addAssistantDialogOpen}
      onOpenChange={setAddAssistantDialogOpen}
      editingKey={null}
      onSave={(assistant) => {
        addAssistant(assistant)
        setSelectedAssistantId(assistant.id)
      }}
    />
  </>
  )
}
