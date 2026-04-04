import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { CostEstimate } from '@/features/multi-agent/lib/cost-estimation'

type Props = {
  open: boolean
  estimate: CostEstimate
  onApprove: () => void
  onCancel: () => void
}

export function CostApprovalModal({
  open,
  estimate,
  onApprove,
  onCancel,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cost Estimate Exceeds Threshold</DialogTitle>
          <DialogDescription>
            The estimated token usage for this multi-agent run exceeds your
            configured approval threshold. Review the breakdown below.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 text-sm">
          {estimate.agents.map((a) => (
            <div key={a.agent} className="flex justify-between">
              <span className="text-muted-foreground">{a.agent}</span>
              <span>~{a.estimatedTokens.toLocaleString()} tokens</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-border pt-1">
            <span className="text-muted-foreground">Orchestrator overhead</span>
            <span>~{estimate.orchestratorOverhead.toLocaleString()} tokens</span>
          </div>
          <div className="flex justify-between font-medium pt-1">
            <span>Estimated range</span>
            <span>
              {estimate.range.min.toLocaleString()}&ndash;
              {estimate.range.max.toLocaleString()} tokens
            </span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Budget</span>
            <span>{estimate.budget.toLocaleString()} tokens</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onApprove}>Proceed</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
