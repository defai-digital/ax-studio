import { useRef } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface DeleteAssistantDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function DeleteAssistantDialog({
  open,
  onOpenChange,
  onConfirm,
}: DeleteAssistantDialogProps) {
  const { t } = useTranslation()
  // Focus Cancel (not the destructive button) so users who habitually
  // press Enter to dismiss dialogs don't accidentally confirm a delete.
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  const handleConfirm = () => {
    onConfirm()
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[425px] max-w-[90vw]"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          cancelButtonRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('assistants:deleteConfirmation')}</DialogTitle>
          <DialogDescription>
            {t('assistants:deleteConfirmationDesc')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button
            ref={cancelButtonRef}
            variant="outline"
            size="sm"
            onClick={handleCancel}
            className="w-full sm:w-auto"
          >
            {t('assistants:cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            size="sm"
            className="w-full sm:w-auto"
            aria-label={t('assistants:delete')}
          >
            {t('assistants:delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
