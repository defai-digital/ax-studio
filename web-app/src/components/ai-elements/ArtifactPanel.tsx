import { XIcon, CodeIcon, EyeIcon, CopyIcon, CheckIcon, HistoryIcon, RotateCcwIcon } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useArtifactPanel, type ArtifactEntry } from '@/hooks/useArtifactPanel'
import { ArtifactPreview } from './ArtifactPreview'
import { type ArtifactType } from '@/lib/artifact-harness'
import { cn } from '@/lib/utils'

const TYPE_LABEL: Record<ArtifactType, string> = {
  html: 'HTML',
  react: 'React',
  svg: 'SVG',
  chartjs: 'Chart.js',
  vega: 'Vega-Lite',
}

type Tab = 'preview' | 'source' | 'history'

interface ArtifactPanelProps {
  threadId: string
  onClose: () => void
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

export function ArtifactPanel({ threadId, onClose }: ArtifactPanelProps) {
  const pinned = useArtifactPanel((state) => state.pinnedByThread[threadId])
  const history = useArtifactPanel((state) => state.historyByThread[threadId] ?? [])
  const updateSource = useArtifactPanel((state) => state.updateSource)
  const restoreVersion = useArtifactPanel((state) => state.restoreVersion)

  const [activeTab, setActiveTab] = useState<Tab>('preview')
  const [copied, setCopied] = useState(false)
  const [editedSource, setEditedSource] = useState('')

  // Sync editedSource when pinned artifact changes
  useEffect(() => {
    if (pinned) setEditedSource(pinned.source)
  }, [pinned])

  if (!pinned) return null

  const label = TYPE_LABEL[pinned.type]

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(pinned.source)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* ignore */ }
  }

  const handleApply = () => {
    updateSource(threadId, editedSource)
    setActiveTab('preview')
  }

  const handleReset = () => {
    setEditedSource(pinned.source)
  }

  const handleRestore = (entry: ArtifactEntry) => {
    restoreVersion(threadId, entry)
    setActiveTab('preview')
  }

  return (
    <div className="h-full flex flex-col bg-background border border-border rounded-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1.5 py-0.5 bg-muted rounded">
            {label}
          </span>
          <span className="text-sm font-medium text-foreground">Artifact</span>
        </div>
        <div className="flex items-center gap-0.5">
          {/* Tab switcher */}
          <button
            onClick={() => setActiveTab('preview')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors',
              activeTab === 'preview'
                ? 'text-foreground bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/70'
            )}
            title="Preview"
          >
            <EyeIcon size={12} />
            Preview
          </button>
          <button
            onClick={() => setActiveTab('source')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors',
              activeTab === 'source'
                ? 'text-foreground bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/70'
            )}
            title="Edit source"
          >
            <CodeIcon size={12} />
            Source
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors',
              activeTab === 'history'
                ? 'text-foreground bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/70'
            )}
            title="Version history"
          >
            <HistoryIcon size={12} />
            History
          </button>
          <button
            onClick={handleCopy}
            title="Copy source"
            className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
          >
            {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
          </button>
          <button
            onClick={onClose}
            title="Close panel"
            className="flex items-center p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
          >
            <XIcon size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === 'preview' && (
          <ArtifactPreview
            type={pinned.type}
            source={pinned.source}
            version={pinned.version}
          />
        )}

        {activeTab === 'source' && (
          <div className="flex flex-col h-full">
            <textarea
              className="flex-1 resize-none p-4 text-xs font-mono bg-muted/30 text-foreground outline-none border-0 focus:ring-0"
              value={editedSource}
              onChange={(e) => setEditedSource(e.target.value)}
              spellCheck={false}
            />
            <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-muted/40 shrink-0">
              <button
                onClick={handleApply}
                disabled={editedSource === pinned.source}
                className="px-3 py-1 rounded text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Apply
              </button>
              <button
                onClick={handleReset}
                disabled={editedSource === pinned.source}
                className="px-3 py-1 rounded text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/70 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Reset
              </button>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="flex-1 overflow-auto p-2 space-y-1">
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground p-4 text-center">No history yet.</p>
            ) : (
              history.map((entry, idx) => {
                const isCurrent = entry.version === pinned.version
                return (
                  <div
                    key={`${entry.version}-${entry.timestamp}`}
                    className={cn(
                      'flex items-center justify-between gap-2 px-3 py-2 rounded text-xs border',
                      isCurrent
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border bg-muted/20 hover:bg-muted/40'
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn(
                        'shrink-0 font-mono font-semibold px-1.5 py-0.5 rounded text-[10px]',
                        isCurrent ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                      )}>
                        v{entry.version}
                      </span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground px-1.5 py-0.5 bg-muted rounded">
                        {TYPE_LABEL[entry.type]}
                      </span>
                      <span className="text-muted-foreground truncate">
                        {idx === 0 ? 'Latest' : formatRelativeTime(entry.timestamp)}
                      </span>
                    </div>
                    {!isCurrent && (
                      <button
                        onClick={() => handleRestore(entry)}
                        className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
                        title="Restore this version"
                      >
                        <RotateCcwIcon size={11} />
                        Restore
                      </button>
                    )}
                    {isCurrent && (
                      <span className="shrink-0 text-[10px] text-primary font-medium">Current</span>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
}
