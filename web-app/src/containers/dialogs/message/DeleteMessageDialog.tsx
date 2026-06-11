import { Trash2 } from "lucide-react";
import { useState, useRef } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface DeleteMessageDialogProps {
  onDelete: () => void
}

export function DeleteMessageDialog({ onDelete }: DeleteMessageDialogProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  // Focus Cancel rather than the destructive button so Enter-to-dismiss
  // doesn't accidentally confirm the delete.
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  const handleDelete = () => {
    onDelete()
    setIsOpen(false)
  }

  const trigger = (
    <Button
      variant="ghost"
      size="icon-xs"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setIsOpen(true)
        }
      }}
    >
      <Trash2 size={16} />
    </Button>
  )

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          cancelButtonRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('common:deleteMessage')}</DialogTitle>
          <DialogDescription>
            {t('common:dialogs.deleteMessage.description')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <DialogClose asChild>
            <Button
              ref={cancelButtonRef}
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
            >
              {t('common:cancel')}
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={handleDelete}
            size="sm"
            className="w-full sm:w-auto"
            aria-label={t('common:deleteMessage')}
          >
            {t('common:delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
