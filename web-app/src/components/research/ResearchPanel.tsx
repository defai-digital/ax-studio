import { useState, useEffect, useRef } from 'react'
import {
  XIcon,
  CopyIcon,
  CheckIcon,
  ActivityIcon,
  FileTextIcon,
  LinkIcon,
  XCircleIcon,
  DownloadIcon,
} from 'lucide-react'
import { useResearchPanel } from '@/hooks/useResearchPanel'
import { useResearch } from '@/hooks/useResearch'
import { ResearchProgress } from './ResearchProgress'
import { ResearchReport } from './ResearchReport'
import { SourcesList } from './SourcesList'
import { cn } from '@/lib/utils'

type Tab = 'progress' | 'report' | 'sources'

interface ResearchPanelProps {
  threadId: string
  onClose: () => void
}

export function ResearchPanel({ threadId, onClose }: ResearchPanelProps) {
  const entry = useResearchPanel((s) => s.getPinned(threadId))
  const { cancelResearch } = useResearch(threadId)

  const [activeTab, setActiveTab] = useState<Tab>('progress')
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)

  // Track whether the user manually selected a tab (to prevent auto-switching away)
  const userPickedTab = useRef(false)

  const isRunning = entry?.status === 'running'
  const isDone = entry?.status === 'done'

  // Reset user choice whenever a new research run starts
  useEffect(() => {
    if (entry?.status === 'running') {
      userPickedTab.current = false
      setActiveTab('progress')
    }
  }, [entry?.status])

  // Auto-switch to report tab only when done AND user hasn't manually picked another tab
  useEffect(() => {
    if (isDone && activeTab === 'progress' && !userPickedTab.current) {
      setActiveTab('report')
    }
  }, [isDone, activeTab])

  if (!entry) return null

  function pickTab(tab: Tab) {
    userPickedTab.current = true
    setActiveTab(tab)
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(entry!.reportMarkdown)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* ignore */
    }
  }

  const handleSave = () => {
    if (!entry?.reportMarkdown) return
    const blob = new Blob([entry.reportMarkdown], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const slug = entry.query.slice(0, 40).replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    a.href = url
    a.download = `research-${slug}.md`
    a.click()
    URL.revokeObjectURL(url)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const statusLabel =
    entry.status === 'running'
      ? 'Researching…'
      : entry.status === 'done'
        ? `${entry.sources.length} sources`
        : entry.status === 'cancelled'
          ? 'Cancelled'
          : 'Error'

  const statusColor =
    entry.status === 'running'
      ? 'text-blue-500'
      : entry.status === 'done'
        ? 'text-green-600 dark:text-green-400'
        : 'text-destructive'

  return (
    <div className="h-full flex flex-col bg-background border border-border rounded-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1.5 py-0.5 bg-muted rounded shrink-0">
            Research
          </span>
          <span className="text-sm font-medium text-foreground truncate" title={entry.query}>
            {entry.query}
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 ml-2">
          {/* Status badge */}
          <span className={cn('text-[10px] font-medium px-1.5', statusColor)}>{statusLabel}</span>

          {/* Tab buttons */}
          <button
            onClick={() => pickTab('progress')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors',
              activeTab === 'progress'
                ? 'text-foreground bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/70'
            )}
            title="Progress"
          >
            <ActivityIcon size={12} />
            Progress
          </button>
          <button
            onClick={() => pickTab('report')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors',
              activeTab === 'report'
                ? 'text-foreground bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/70'
            )}
            title="Report"
          >
            <FileTextIcon size={12} />
            Report
          </button>
          <button
            onClick={() => pickTab('sources')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors',
              activeTab === 'sources'
                ? 'text-foreground bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/70'
            )}
            title="Sources"
          >
            <LinkIcon size={12} />
            Sources
            {entry.sources.length > 0 && (
              <span className="ml-0.5 px-1 py-0.5 rounded-full bg-muted text-[9px] font-bold text-muted-foreground">
                {entry.sources.length}
              </span>
            )}
          </button>

          {/* Copy report (when done) */}
          {isDone && entry.reportMarkdown && (
            <button
              onClick={handleCopy}
              title="Copy report"
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
            >
              {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
            </button>
          )}

          {/* Save report (when done) */}
          {isDone && entry.reportMarkdown && (
            <button
              onClick={handleSave}
              title="Save report as Markdown"
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
            >
              {saved ? <CheckIcon size={12} /> : <DownloadIcon size={12} />}
            </button>
          )}

          {/* Cancel (while running) */}
          {isRunning && (
            <button
              onClick={cancelResearch}
              title="Cancel research"
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-destructive hover:bg-destructive/10 transition-colors"
            >
              <XCircleIcon size={12} />
              Cancel
            </button>
          )}

          {/* Close */}
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
        {activeTab === 'progress' && <ResearchProgress steps={entry.steps} />}
        {activeTab === 'report' && (
          <ResearchReport
            markdown={entry.reportMarkdown}
            isStreaming={isRunning}
            sources={entry.sources}
          />
        )}
        {activeTab === 'sources' && <SourcesList sources={entry.sources} />}
      </div>
    </div>
  )
}
