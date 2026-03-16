import { useState, useRef } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogClose,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface AddProviderDialogProps {
  onCreateProvider: (name: string) => void
  children: React.ReactNode
}

export function AddProviderDialog({
  onCreateProvider,
  children,
}: AddProviderDialogProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const createButtonRef = useRef<HTMLButtonElement>(null)

  const handleCreate = () => {
    if (name.trim()) {
      onCreateProvider(name.trim())
      setName('')
      setIsOpen(false)
    }
  }

  const handleCancel = () => {
    setName('')
    setIsOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && name.trim()) {
      e.preventDefault()
      handleCreate()
    }
    // Prevent key from being captured by parent components
    e.stopPropagation()
  }

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (!open) {
      setName('')
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="sm:max-w-[425px] max-w-[90vw]"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          createButtonRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('provider:addOpenAIProvider')}</DialogTitle>
        </DialogHeader>
        <input
          data-testid="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-4 py-2.5 rounded-xl bg-muted/50 border border-border/50 outline-none text-[14px] focus:border-primary/30 transition-colors"
          placeholder={t('provider:enterNameForProvider')}
          onKeyDown={handleKeyDown}
        />
        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <DialogClose asChild>
            <Button
              variant="outline"
              size="sm"
              className="w-full sm:w-auto"
              onClick={handleCancel}
            >
              {t('common:cancel')}
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button
              ref={createButtonRef}
              disabled={!name.trim()}
              onClick={handleCreate}
              className="w-full sm:w-auto"
              size="sm"
              aria-label={t('common:create')}
            >
              {t('common:create')}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
