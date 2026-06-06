import { invoke } from '@tauri-apps/api/core'
import type { ResearchSource } from '@/features/research/hooks/useResearchPanel'

interface SourcesListProps {
  sources: ResearchSource[]
}

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

export function SourcesList({ sources }: SourcesListProps) {
  if (sources.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No sources collected yet.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto p-3 space-y-2">
      {sources.map((source, i) => {
        const domain = getDomain(source.url)
        const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=16`

        return (
          <button
            key={`${source.url}-${i}`}
            onClick={() => openUrl(source.url)}
            className="w-full text-left flex items-start gap-2 px-3 py-2 rounded border border-border bg-muted/20 hover:bg-muted/50 transition-colors group"
          >
            <img
              src={faviconUrl}
              alt=""
              className="shrink-0 w-4 h-4 mt-0.5 rounded-sm"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none'
              }}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                  [{i + 1}]
                </span>
                <span className="text-xs font-medium text-foreground truncate group-hover:underline">
                  {source.title || domain}
                </span>
              </div>
              <p className="text-[10px] text-primary truncate mt-0.5">{domain}</p>
              {source.snippet && (
                <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
                  {source.snippet}
                </p>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}
