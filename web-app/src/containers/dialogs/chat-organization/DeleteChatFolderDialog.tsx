import { useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useChatOrganization } from '@/hooks/threads/useChatOrganization'
import type { ChatFolder } from '@/services/chat-organization/types'

interface DeleteChatFolderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  folder: ChatFolder | null
}

/**
 * Confirms deletion of a chat folder. Member chats are unfiled, never
 * deleted (handled by the store's deleteFolder).
 */
export function DeleteChatFolderDialog({
  open,
  onOpenChange,
  folder,
}: DeleteChatFolderDialogProps) {
  const { t } = useTranslation()
  // Focus Cancel instead of the destructive button so Enter-to-dismiss
  // doesn't accidentally delete the folder.
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const { deleteFolder } = useChatOrganization()

  const handleConfirm = async () => {
    if (!folder) return
    try {
      await deleteFolder(folder.id)
      toast.success(
        t('common:chatOrganization.folderDeleted', { folderName: folder.name })
      )
      onOpenChange(false)
    } catch (error) {
      console.error('Delete folder error:', error)
      toast.error(t('common:error'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          cancelButtonRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t('common:chatOrganization.deleteFolderDialog.title')}
          </DialogTitle>
          <DialogDescription>
            {t('common:chatOrganization.deleteFolderDialog.description', {
              folderName: folder?.name ?? '',
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            ref={cancelButtonRef}
            size="sm"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {t('common:cancel')}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleConfirm}
            aria-label={t('common:chatOrganization.deleteFolderDialog.ariaLabel', {
              folderName: folder?.name ?? '',
            })}
          >
            {t('common:chatOrganization.deleteFolderDialog.deleteButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
