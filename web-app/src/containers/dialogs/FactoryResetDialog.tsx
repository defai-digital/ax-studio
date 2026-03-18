import { useRef } from 'react'
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
import { AlertTriangle } from 'lucide-react'

interface FactoryResetDialogProps {
  onReset: () => void
  children: React.ReactNode
}

export function FactoryResetDialog({
  onReset,
  children,
}: FactoryResetDialogProps) {
  const { t } = useTranslation()
  const resetButtonRef = useRef<HTMLButtonElement>(null)

  const handleReset = () => {
    onReset()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleReset()
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="sm:max-w-[425px] max-w-[90vw]"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          resetButtonRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-destructive">
            {t('settings:general.factoryResetTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('settings:general.factoryResetDesc')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/10">
          <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
          <span className="text-[12px] text-muted-foreground">
            {t('settings:general.factoryResetWarning')}
          </span>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              {t('settings:general.cancel')}
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button
              ref={resetButtonRef}
              variant="destructive"
              onClick={handleReset}
              onKeyDown={handleKeyDown}
              size="sm"
              className="w-full sm:w-auto"
              aria-label={t('settings:general.reset')}
            >
              {t('settings:general.reset')}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
