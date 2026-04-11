import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import type { CitationSource } from '@/types/citation-types'

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

interface CitationChipProps {
  /** The citation number (1-based) */
  number: number
  /** Source data for the hover card */
  source: CitationSource
}

export function CitationChip({ number, source }: CitationChipProps) {
  const [imgError, setImgError] = useState(false)
  const domain = source.url ? getDomain(source.url) : source.documentName ?? 'source'
  const faviconUrl = source.url ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : null

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          className="inline-flex items-center text-[10px] font-mono text-primary bg-primary/10 hover:bg-primary/20 rounded px-1 py-0.5 cursor-pointer transition-colors align-super leading-none mx-0.5"
          onClick={() => source.url && openUrl(source.url)}
          type="button"
        >
          [{number}]
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="w-72 p-3">
        <div className="flex items-start gap-2">
          {faviconUrl && !imgError && (
            <img
              src={faviconUrl}
              alt=""
              className="shrink-0 w-4 h-4 mt-0.5 rounded-sm"
              onError={() => setImgError(true)}
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground line-clamp-2">
              {source.title || domain}
            </p>
            <p className="text-[10px] text-primary mt-0.5 truncate">{domain}</p>
            {source.snippet && (
              <p className="text-[11px] text-muted-foreground mt-1.5 line-clamp-3">
                {source.snippet}
              </p>
            )}
            {source.url && (
              <button
                onClick={() => openUrl(source.url!)}
                className="text-[11px] text-primary hover:underline mt-2 inline-block"
                type="button"
              >
                Open source
              </button>
            )}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
