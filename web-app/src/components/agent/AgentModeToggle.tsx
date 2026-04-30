import { Bot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type Props = {
  enabled: boolean
  onToggle: () => void
  axError: string | null
}

export function AgentModeToggle({ enabled, onToggle, axError }: Props) {
  const tooltip = axError
    ? axError
    : enabled
    ? 'Agent Mode ON — messages go to AutomatosX'
    : 'Enable Agent Mode (AutomatosX)'

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={enabled ? 'secondary' : 'ghost'}
          size="icon-sm"
          onClick={onToggle}
          aria-label="Toggle Agent Mode"
          className={enabled ? 'text-primary' : ''}
        >
          <Bot className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs text-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}
