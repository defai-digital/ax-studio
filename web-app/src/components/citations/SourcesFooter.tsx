import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { ConfidenceBadge } from './ConfidenceBadge'
import type { CitationData } from '@/types/citation-types'

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function openUrl(url: string) {
  invoke('plugin:opener|open_url', { url }).catch(console.warn)
}

interface SourcesFooterProps {
  citationData: CitationData
}

export function SourcesFooter({ citationData }: SourcesFooterProps) {
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
        <span className="text-[11px] text-muted-foreground">-</span>
        <ConfidenceBadge confidence={confidence} />
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
                      ;(e.target as HTMLImageElement).style.display = 'none'
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
