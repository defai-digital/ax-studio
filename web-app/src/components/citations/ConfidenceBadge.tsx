import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { CitationData } from '@/types/citation-types'

const confidenceConfig: Record<
  CitationData['confidence'],
  { color: string; dotColor: string; label: string; tooltip: string }
> = {
  strong: {
    color: 'text-green-700 dark:text-green-400',
    dotColor: 'bg-green-500',
    label: 'Well-supported',
    tooltip: 'Multiple sources corroborate this response',
  },
  moderate: {
    color: 'text-amber-700 dark:text-amber-400',
    dotColor: 'bg-amber-500',
    label: 'Partially supported',
    tooltip: 'Some sources support this response',
  },
  uncertain: {
    color: 'text-orange-700 dark:text-orange-400',
    dotColor: 'bg-orange-500',
    label: 'Limited sources',
    tooltip: 'Few or no external sources available',
  },
}

interface ConfidenceBadgeProps {
  confidence: CitationData['confidence']
}

export function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
  const config = confidenceConfig[confidence]

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${config.color} cursor-default`}
          >
            <span className={`size-1.5 rounded-full ${config.dotColor}`} />
            {config.label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-52">
          {config.tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
