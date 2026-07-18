import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/react-i18next-compat'

interface NamePromptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  placeholder?: string
  initialValue?: string
  onSubmit: (name: string) => void | Promise<void>
}

/**
 * Minimal single-input dialog used for creating/renaming chat folders and
 * creating tags. The caller is responsible for closing the dialog after a
 * successful submit.
 */
export function NamePromptDialog({
  open,
  onOpenChange,
  title,
  placeholder,
  initialValue = '',
  onSubmit,
}: NamePromptDialogProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    if (open) setValue(initialValue)
  }, [open, initialValue])

  const trimmed = value.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (trimmed) void onSubmit(trimmed)
          }}
        >
          <Input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder}
          />
          <DialogFooter className="mt-4">
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => onOpenChange(false)}
            >
              {t('common:cancel')}
            </Button>
            <Button size="sm" type="submit" disabled={!trimmed}>
              {t('common:save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
