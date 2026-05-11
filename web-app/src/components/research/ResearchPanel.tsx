import { useState, useEffect, useRef, useCallback } from 'react'
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
import { useResearchPanel } from '@/hooks/research/useResearchPanel'
import { cancelResearchForThread } from '@/hooks/research/useResearch'
import { ResearchProgress } from './ResearchProgress'
import { ResearchReport } from './ResearchReport'
import { SourcesList } from './SourcesList'
import { cn } from '@/lib/utils'

type Tab = 'progress' | 'report' | 'sources'
type ResearchStatus = 'running' | 'done' | 'cancelled' | 'error'

interface ResearchPanelProps {
  threadId: string
  onClose: () => void
}

function getStatusMeta(status: ResearchStatus, sourceCount: number) {
  switch (status) {
    case 'running':
      return { label: 'Researching…', color: 'text-blue-500' }
    case 'done':
      return {
        label: `${sourceCount} sources`,
        color: 'text-green-600 dark:text-green-400',
      }
    case 'cancelled':
      return { label: 'Cancelled', color: 'text-destructive' }
    case 'error':
      return { label: 'Error', color: 'text-destructive' }
  }
}

type TabButtonProps = {
  active: boolean
  icon: React.ComponentType<{ size?: number }>
  label: string
  onClick: () => void
  badge?: number
}

function TabButton({ active, icon: Icon, label, onClick, badge }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors',
        active
          ? 'text-foreground bg-background shadow-sm'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/70'
      )}
      title={label}
    >
      <Icon size={12} />
      {label}
      {!!badge && (
        <span className="ml-0.5 px-1 py-0.5 rounded-full bg-muted text-[9px] font-bold text-muted-foreground">
          {badge}
        </span>
      )}
    </button>
  )
}

type ReportActionButtonProps = {
  active: boolean
  activeIcon: React.ComponentType<{ size?: number }>
  idleIcon: React.ComponentType<{ size?: number }>
  title: string
  onClick: () => void
}

function ReportActionButton({
  active,
  activeIcon: ActiveIcon,
  idleIcon: IdleIcon,
  title,
  onClick,
}: ReportActionButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
    >
      {active ? <ActiveIcon size={12} /> : <IdleIcon size={12} />}
    </button>
  )
}

export function ResearchPanel({ threadId, onClose }: ResearchPanelProps) {
  const entry = useResearchPanel((s) => s.getPinned(threadId))
  const cancelResearch = useCallback(() => cancelResearchForThread(threadId), [threadId])

  const [activeTab, setActiveTab] = useState<Tab>('progress')
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  // Track whether the user manually selected a tab (to prevent auto-switching away)
  const userPickedTab = useRef(false)

  const isRunning = entry?.status === 'running'
  const isDone = entry?.status === 'done'

  // Reset user choice and cancelling state whenever a new research run starts
  useEffect(() => {
    if (entry?.status === 'running') {
      userPickedTab.current = false
      setActiveTab('progress')
      setCancelling(false)
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
      await navigator.clipboard.writeText(entry?.reportMarkdown ?? '')
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

  const statusMeta = getStatusMeta(entry.status, entry.sources.length)
  const hasReport = isDone && !!entry.reportMarkdown

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
          <span className={cn('text-[10px] font-medium px-1.5', statusMeta.color)}>
            {statusMeta.label}
          </span>

          {/* Tab buttons — Report first so it's the leftmost tab */}
          <TabButton
            active={activeTab === 'report'}
            icon={FileTextIcon}
            label="Report"
            onClick={() => pickTab('report')}
          />
          <TabButton
            active={activeTab === 'progress'}
            icon={ActivityIcon}
            label="Progress"
            onClick={() => pickTab('progress')}
          />
          <TabButton
            active={activeTab === 'sources'}
            icon={LinkIcon}
            label="Sources"
            badge={entry.sources.length}
            onClick={() => pickTab('sources')}
          />

          {/* Copy report (when done) */}
          {hasReport && (
            <ReportActionButton
              active={copied}
              activeIcon={CheckIcon}
              idleIcon={CopyIcon}
              title="Copy report"
              onClick={handleCopy}
            />
          )}

          {/* Save report (when done) */}
          {hasReport && (
            <ReportActionButton
              active={saved}
              activeIcon={CheckIcon}
              idleIcon={DownloadIcon}
              title="Save report as Markdown"
              onClick={handleSave}
            />
          )}

          {/* Cancel (while running) */}
          {isRunning && (
            <button
              onClick={() => { setCancelling(true); cancelResearch() }}
              disabled={cancelling}
              title="Cancel research"
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <XCircleIcon size={12} />
              {cancelling ? 'Cancelling…' : 'Cancel'}
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
