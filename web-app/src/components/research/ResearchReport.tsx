import { memo, useMemo } from 'react'
import { RenderMarkdown } from '@/containers/RenderMarkdown'
import type { ResearchSource } from '@/hooks/research/useResearchPanel'

interface ResearchReportProps {
  markdown: string
  isStreaming: boolean
  sources: ResearchSource[]
}

/**
 * Strip the ## Sources / ## References section the model may append at the end
 * (since sources are shown in a dedicated tab).
 */
function stripSourcesSection(md: string): string {
  // Only strip a trailing Sources/References section that has no other ## heading after it
  return md.replace(/\n## (?:Sources|References|Bibliography)\n(?:(?!## ).)*$/is, '').trimEnd()
}

/**
 * Replace bare [N] citation markers with Markdown links [[N]](url)
 * so they become clickable in the rendered report.
 */
function makeClickableCitations(md: string, sources: ResearchSource[]): string {
  if (sources.length === 0) return md
  return md.replace(/\[(\d+)\](?!\()/g, (match, num) => {
    const idx = parseInt(num, 10) - 1
    if (idx >= 0 && idx < sources.length) {
      return `[${match}](${sources[idx].url})`
    }
    return match
  })
}

export const ResearchReport = memo(function ResearchReport({
  markdown,
  isStreaming,
  sources,
}: ResearchReportProps) {
  const processed = useMemo(() => {
    if (!markdown) return ''
    const stripped = stripSourcesSection(markdown)
    return makeClickableCitations(stripped, sources)
  }, [markdown, sources])

  if (!processed && !isStreaming) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Report will appear here once writing begins…
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto p-4">
      <RenderMarkdown
        content={processed + (isStreaming ? ' ▌' : '')}
        className="prose prose-sm dark:prose-invert max-w-none"
      />
    </div>
  )
})
