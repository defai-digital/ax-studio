import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToolApproval } from '@/hooks/tools/useToolApproval'
import { Shield, Wrench } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'

export default function ToolApproval() {
  const { t } = useTranslation()
  const { isModalOpen, modalProps, setModalOpen } = useToolApproval()

  if (!modalProps) {
    return null
  }

  const { toolName, toolParameters, onApprove, onDeny } = modalProps

  const handleAllowOnce = () => {
    onApprove(true) // true = allow once only
  }

  const handleAllow = () => {
    onApprove(false) // false = remember for this thread
  }

  const handleDeny = () => {
    onDeny()
  }

  const handleDialogOpen = (open: boolean) => {
    setModalOpen(open)
    if (!open) {
      onDeny()
    }
  }

  return (
    <Dialog open={isModalOpen} onOpenChange={handleDialogOpen}>
      <DialogContent showCloseButton={false} className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="size-4" />
            {t('tools:toolApproval.title')}
          </DialogTitle>
          <DialogDescription>
            <strong className="text-foreground">{toolName}</strong>{' '}
            {t('tools:toolApproval.description')}
            <span className="text-sm">
              {' '}
              {t('tools:toolApproval.permissionScope')}
            </span>
          </DialogDescription>
        </DialogHeader>

        {toolParameters && Object.keys(toolParameters).length > 0 && (
          <div className="bg-muted/30 p-3 border border-border/50 rounded-lg overflow-x-auto">
            <h4 className="text-[13px] font-medium mb-2">
              {t('tools:toolApproval.parameters')}
            </h4>
            <pre className="text-[12px] font-mono whitespace-pre-wrap text-muted-foreground">
              {JSON.stringify(toolParameters, null, 2)}
            </pre>
          </div>
        )}

        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/10">
          <Shield className="size-4 text-amber-500 shrink-0 mt-0.5" />
          <span className="text-[12px] text-muted-foreground">
            {t('tools:toolApproval.securityNotice')}
          </span>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={handleDeny}>
            {t('tools:toolApproval.deny')}
          </Button>
          <Button variant="outline" size="sm" onClick={handleAllowOnce}>
            {t('tools:toolApproval.allowOnce')}
          </Button>
          <Button size="sm" onClick={handleAllow} autoFocus>
            {t('tools:toolApproval.alwaysAllow')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
