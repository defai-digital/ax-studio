import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { useState } from 'react'

import { useAssistant } from '@/hooks/chat/useAssistant'

import HeaderPage from '@/containers/HeaderPage'
import { IconCirclePlus, IconPencil, IconTrash } from '@tabler/icons-react'
import AddEditAssistant from '@/containers/dialogs/AddEditAssistant'
import { DeleteAssistantDialog } from '@/containers/dialogs'
import { AvatarEmoji } from '@/components/common/AvatarEmoji'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Button } from '@/components/ui/button'
import SettingsMenu from '@/components/common/SettingsMenu'
import { cn } from '@/lib/utils'
import { Bot } from 'lucide-react'

export const Route = createFileRoute(route.settings.assistant)({
  component: AssistantContent,
})

function AssistantContent() {
  const { t } = useTranslation()
  const { assistants, addAssistant, updateAssistant, deleteAssistant } =
    useAssistant()
  const [open, setOpen] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleDelete = (id: string) => {
    setDeletingId(id)
    setDeleteConfirmOpen(true)
  }

  const confirmDelete = () => {
    if (deletingId) {
      deleteAssistant(deletingId)
      setDeleteConfirmOpen(false)
      setDeletingId(null)
    }
  }

  const handleSave = (assistant: Assistant) => {
    if (editingKey) {
      updateAssistant(assistant)
    } else {
      addAssistant(assistant)
    }
    setOpen(false)
    setEditingKey(null)
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
          <span className="font-medium text-base font-studio">
            {t('common:settings')}
          </span>
          <Button
            onClick={() => {
              setEditingKey(null)
              setOpen(true)
            }}
            size="sm"
            variant="outline"
            className="relative z-50"
          >
            <IconCirclePlus size={16} />
            {t('assistants:addAssistant')}
          </Button>
        </div>
      </HeaderPage>
      <div className="flex flex-1 min-h-0">
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
              <Bot className="size-3.5 text-white" strokeWidth={2.5} />
            </div>
            <h1
              className="text-foreground tracking-tight"
              style={{ fontSize: '16px', fontWeight: 600 }}
            >
              {t('common:assistants')}
            </h1>
          </div>
          <div className="px-8 py-7">
            <div className="max-w-2xl space-y-6">
              {assistants
                .slice()
                .sort((a, b) => a.created_at - b.created_at)
                .map((assistant) => (
                  <div
                    className="bg-secondary dark:bg-secondary/20 p-4 rounded-lg flex items-center gap-4"
                    key={assistant.id}
                  >
                    <div className="flex items-start gap-3 flex-1">
                      {assistant?.avatar && (
                        <div className="shrink-0 w-8 h-8 relative flex items-center justify-center bg-secondary rounded-md">
                          <AvatarEmoji
                            avatar={assistant?.avatar}
                            imageClassName="w-5 h-5 object-contain"
                            textClassName="text-lg"
                          />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="text-base font-studio font-medium line-clamp-1">
                          {assistant.name}
                        </h3>
                        <p className="text-muted-foreground leading-normal text-xs line-clamp-2 mt-1">
                          {assistant.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={t('assistants:editAssistant')}
                        onClick={() => {
                          setEditingKey(assistant.id)
                          setOpen(true)
                        }}
                      >
                        <IconPencil className="text-muted-foreground size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={t('assistants:deleteAssistant')}
                        onClick={() => handleDelete(assistant.id)}
                      >
                        <IconTrash className="text-destructive size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
          <AddEditAssistant
            open={open}
            onOpenChange={setOpen}
            editingKey={editingKey}
            initialData={
              editingKey
                ? assistants.find((a) => a.id === editingKey)
                : undefined
            }
            onSave={handleSave}
          />
          <DeleteAssistantDialog
            open={deleteConfirmOpen}
            onOpenChange={setDeleteConfirmOpen}
            onConfirm={confirmDelete}
          />
        </div>
      </div>
    </div>
  )
}
