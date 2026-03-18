import { type ReactNode, memo, useState } from 'react'
import { AppWindowIcon } from 'lucide-react'
import { type ArtifactType } from '@/lib/artifact-harness'
import { ArtifactBlock } from './ArtifactBlock'
import { cn } from '@/lib/utils'

interface RenderableCodeBlockProps {
  type: ArtifactType
  source: string
  threadId?: string
  children: ReactNode
}

const TYPE_LABEL: Record<ArtifactType, string> = {
  html: 'HTML',
  react: 'React',
  svg: 'SVG',
  chartjs: 'Chart.js',
  vega: 'Vega-Lite',
}

/**
 * Wraps a plain code block (html/jsx/tsx/svg) with a "Render" button in the
 * top-right corner. Clicking switches the block in-place to an ArtifactBlock
 * so the user can preview it without asking the model to regenerate.
 */
export const RenderableCodeBlock = memo(function RenderableCodeBlock({
  type,
  source,
  threadId,
  children,
}: RenderableCodeBlockProps) {
  const [rendered, setRendered] = useState(false)

  if (rendered) {
    return (
      <ArtifactBlock type={type} source={source} threadId={threadId}>
        {children}
      </ArtifactBlock>
    )
  }

  return (
    <div className="relative">
      {/* Render button — always visible in top-right corner */}
      <button
        onClick={() => setRendered(true)}
        title={`Render as ${TYPE_LABEL[type]} artifact`}
        className={cn(
          'absolute top-2 right-2 z-10',
          'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium',
          'bg-muted text-muted-foreground border border-border',
          'hover:bg-background hover:text-foreground hover:border-primary/40 transition-colors'
        )}
      >
        <AppWindowIcon size={12} />
        Render
      </button>
      {children}
    </div>
  )
})
