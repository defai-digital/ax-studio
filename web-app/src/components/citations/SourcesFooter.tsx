import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { CitationData } from '@/types/citation-types'
import { getDomain, openUrl } from '@/lib/utils/url'

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

function ConfidenceBadge({ confidence }: { confidence: CitationData['confidence'] }) {
  const config = confidenceConfig[confidence]
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${config.color} cursor-default`}>
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

interface SourcesFooterProps {
  citationData: CitationData
  /** Whether to show the confidence badge (controlled by guardrails setting) */
  showConfidence?: boolean
}

export function SourcesFooter({ citationData, showConfidence = true }: SourcesFooterProps) {
  const [expanded, setExpanded] = useState(false)
  const { sources, confidence } = citationData

  if (sources.length === 0) return null

  return (
    <div className="mt-3 border border-border rounded-lg overflow-hidden">
      {/* Summary bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
        type="button"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="text-[11px] text-muted-foreground">
          {sources.length} {sources.length === 1 ? 'source' : 'sources'} used
        </span>
        {showConfidence && (
          <>
            <span className="text-[11px] text-muted-foreground">-</span>
            <ConfidenceBadge confidence={confidence} />
          </>
        )}
      </button>

      {/* Expanded source list */}
      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-1.5 max-h-60 overflow-y-auto">
          {sources.map((source, i) => {
            const domain = source.url ? getDomain(source.url) : source.documentName ?? 'source'
            const faviconUrl = source.url
              ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16`
              : null

            return (
              <button
                key={source.id}
                onClick={() => source.url && openUrl(source.url)}
                className="w-full text-left flex items-start gap-2 px-2 py-1.5 rounded hover:bg-muted/50 transition-colors group"
                type="button"
              >
                {faviconUrl ? (
                  <img
                    src={faviconUrl}
                    alt=""
                    className="shrink-0 w-3.5 h-3.5 mt-0.5 rounded-sm"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                    }}
                  />
                ) : (
                  <span className="shrink-0 w-3.5 h-3.5 mt-0.5 rounded-sm bg-muted" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                      [{i + 1}]
                    </span>
                    <span className="text-[11px] font-medium text-foreground truncate group-hover:underline">
                      {source.title || domain}
                    </span>
                  </div>
                  {source.snippet && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">
                      {source.snippet}
                    </p>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
