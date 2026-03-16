import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { useContextSizeApproval } from '@/hooks/useModelContextApproval'
import { useTranslation } from '@/i18n'
import { AlertTriangle } from 'lucide-react'

export default function OutOfContextPromiseModal() {
  const { t } = useTranslation()
  const { isModalOpen, modalProps, setModalOpen } = useContextSizeApproval()
  if (!modalProps) {
    return null
  }
  const { onApprove, onDeny } = modalProps

  const handleContextLength = () => {
    onApprove('ctx_len')
  }

  const handleContextShift = () => {
    onApprove('context_shift')
  }

  const handleDialogOpen = (open: boolean) => {
    setModalOpen(open)
    if (!open) {
      onDeny()
    }
  }

  return (
    <Dialog open={isModalOpen} onOpenChange={handleDialogOpen}>
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        className="max-w-[440px]"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-4" />
            {t('model-errors:title')}
          </DialogTitle>
          <DialogDescription>
            {t('model-errors:description')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <button
            onClick={() => {
              handleContextShift()
            }}
            className="w-full p-4 rounded-xl border border-border/50 hover:border-border hover:bg-muted/20 transition-all text-left"
          >
            <div style={{ fontSize: '14px', fontWeight: 500 }}>
              {t('model-errors:truncateInput')}
            </div>
            <div className="text-[12px] text-muted-foreground mt-0.5">
              {t('model-errors:truncateInputDescription')}
            </div>
          </button>
          <button
            onClick={() => {
              handleContextLength()
            }}
            className="w-full p-4 rounded-xl border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-all text-left"
          >
            <div
              style={{ fontSize: '14px', fontWeight: 500 }}
              className="text-primary"
            >
              {t('model-errors:increaseContextSize')}
            </div>
            <div className="text-[12px] text-muted-foreground mt-0.5">
              {t('model-errors:increaseContextSizeDescription')}
            </div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
