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
  // Focus Cancel (not the reset button) so users who habitually press
  // Enter to dismiss dialogs don't accidentally wipe their data.
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  const handleReset = () => {
    onReset()
  }

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="sm:max-w-[425px] max-w-[90vw]"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          cancelButtonRef.current?.focus()
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
            <Button ref={cancelButtonRef} variant="outline" size="sm">
              {t('settings:general.cancel')}
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button
              variant="destructive"
              onClick={handleReset}
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
