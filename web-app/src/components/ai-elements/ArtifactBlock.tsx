import { type ReactNode, Component, memo, useState } from 'react'
import { CopyIcon, CheckIcon, ExternalLinkIcon, CodeIcon, EyeIcon, AlertCircleIcon } from 'lucide-react'
import { type ArtifactType } from '@/lib/artifact-harness'
import { useArtifactPanel } from '@/hooks/ui/useArtifactPanel'
import { ArtifactPreview } from './ArtifactPreview'
import { cn } from '@/lib/utils'

interface ArtifactBlockProps {
  type: ArtifactType
  source: string
  threadId?: string
  /** Already syntax-highlighted JSX from Streamdown */
  children: ReactNode
}

class PreviewErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null }
  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex items-start gap-2 px-3 py-3 text-destructive text-xs">
          <AlertCircleIcon size={13} className="mt-0.5 shrink-0" />
          <span>Failed to render artifact: {this.state.error}</span>
        </div>
      )
    }
    return this.props.children
  }
}

const TYPE_LABEL: Record<ArtifactType, string> = {
  html: 'HTML',
  react: 'React',
  svg: 'SVG',
  chartjs: 'Chart.js',
  vega: 'Vega-Lite',
}

function CopyButton({ source }: { source: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(source)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* ignore */ }
  }

  return (
    <button
      onClick={handleCopy}
      title="Copy source"
      className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
    >
      {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  )
}

export const ArtifactBlock = memo(function ArtifactBlock({
  type,
  source,
  threadId,
  children,
}: ArtifactBlockProps) {
  const [activeTab, setActiveTab] = useState<'code' | 'preview'>('preview')
  const pinArtifact = useArtifactPanel((state) => state.pinArtifact)

  const handlePin = () => {
    if (threadId) {
      pinArtifact(threadId, type, source)
    }
  }

  const label = TYPE_LABEL[type]

  return (
    <div className="rounded-xl border border-border overflow-hidden my-2">
      {/* Tab bar */}
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-2 py-1">
        {/* Left: type badge + tabs */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1.5 py-0.5 bg-muted rounded mr-1">
            {label}
          </span>
          <button
            onClick={() => setActiveTab('code')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors',
              activeTab === 'code'
                ? 'text-foreground bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/70'
            )}
          >
            <CodeIcon size={12} />
            Code
          </button>
          <button
            onClick={() => setActiveTab('preview')}
            className={cn(
              'flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors',
              activeTab === 'preview'
                ? 'text-foreground bg-background shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/70'
            )}
          >
            <EyeIcon size={12} />
            Preview
          </button>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-0.5">
          <CopyButton source={source} />
          {threadId && (
            <button
              onClick={handlePin}
              title="Open in side panel"
              className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
            >
              <ExternalLinkIcon size={12} />
              <span>Panel</span>
            </button>
          )}
        </div>
      </div>

      {/* Code tab — Streamdown's highlighted output */}
      {activeTab === 'code' && (
        <div className="[&>[data-streamdown=code-block]]:rounded-none [&>[data-streamdown=code-block]]:border-0">
          {children}
        </div>
      )}

      {/* Preview tab — sandboxed iframe */}
      {activeTab === 'preview' && (
        <div className="h-[480px]">
          <PreviewErrorBoundary>
            <ArtifactPreview type={type} source={source} />
          </PreviewErrorBoundary>
        </div>
      )}
    </div>
  )
})
