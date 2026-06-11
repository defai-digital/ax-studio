import { Atom, Binary, Eye, Globe, Wrench } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Fragment, memo } from 'react'

interface CapabilitiesProps {
  capabilities: string[]
  /** When true, renders lightweight badges with title attrs instead of Radix Tooltips. */
  compact?: boolean
}

const capabilityStyles: Record<string, string> = {
  tools: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  vision: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  reasoning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  embeddings: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  web_search: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
}

function getIcon(capability: string) {
  switch (capability) {
    case 'vision': return <Eye className="size-2.5" />
    case 'tools': return <Wrench className="size-2.5" />
    case 'reasoning': return <Atom className="size-2.5" />
    case 'embeddings': return <Binary className="size-2.5" />
    case 'web_search': return <Globe className="size-2.5" />
    default: return null
  }
}

function getTooltipLabel(capability: string) {
  if (capability === 'web_search') return 'Web Search'
  if (capability === 'embeddings') return 'Embedding Model (for RAG/vectors, not chat)'
  return capability
}

const Capabilities = memo(function Capabilities({ capabilities, compact }: CapabilitiesProps) {
  if (!capabilities.length) return null

  // Filter out proactive capability as it's now managed in MCP settings
  const filteredCapabilities = capabilities.filter((capability) => {
    return capability !== 'proactive'
  })

  return (
    <div className="flex gap-1">
      {filteredCapabilities.map((capability: string, capIndex: number) => {
        const icon = getIcon(capability)
        if (!icon) return null

        const badgeStyle = capabilityStyles[capability] || 'bg-muted text-muted-foreground'
        const badgeCls = `inline-flex items-center px-1.5 py-0.5 rounded text-[10px] ${badgeStyle}`

        // Compact mode: simple span with title — avoids Radix Tooltip overhead
        if (compact) {
          return (
            <span
              key={`capability-${capIndex}`}
              className={badgeCls}
              title={getTooltipLabel(capability)}
            >
              {icon}
            </span>
          )
        }

        return (
          <Fragment key={`capability-${capIndex}`}>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={badgeCls} title={capability}>
                    {icon}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{getTooltipLabel(capability)}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Fragment>
        )
      })}
    </div>
  )
})

export default Capabilities
