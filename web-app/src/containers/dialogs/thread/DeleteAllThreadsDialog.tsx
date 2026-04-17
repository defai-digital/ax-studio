import { Trash2 } from "lucide-react";
import { useState, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
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
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import { route } from '@/constants/routes'

interface DeleteAllThreadsDialogProps {
  onDeleteAll: () => void
  onDropdownClose?: () => void
}

export function DeleteAllThreadsDialog({
  onDeleteAll,
  onDropdownClose,
}: DeleteAllThreadsDialogProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  // Focus Cancel instead of the destructive button so Enter-to-dismiss
  // doesn't accidentally wipe every thread.
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (!open && onDropdownClose) {
      onDropdownClose()
    }
  }

  const handleDeleteAll = () => {
    onDeleteAll()
    setIsOpen(false)
    if (onDropdownClose) onDropdownClose()
    toast.success(t('common:toast.deleteAllThreads.title'), {
      id: 'delete-all-threads',
      description: t('common:toast.deleteAllThreads.description'),
    })
    setTimeout(() => {
      navigate({ to: route.home })
    }, 0)
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}>
          <Trash2 size={16} />
          <span>{t('common:deleteAll')}</span>
        </DropdownMenuItem>
      </DialogTrigger>
      <DialogContent
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          cancelButtonRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t('common:dialogs.deleteAllThreads.title')}
          </DialogTitle>
          <DialogDescription>
            {t('common:dialogs.deleteAllThreads.description')}
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
            onClick={handleDeleteAll}
            size="sm"
            className="w-full sm:w-auto"
            aria-label={t('common:deleteAll')}
          >
            {t('common:deleteAll')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
