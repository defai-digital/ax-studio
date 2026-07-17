import { Route } from 'lucide-react'

type RoutingBadgeProps = {
  modelId: string
  providerId?: string
  reason: string
}

export function RoutingBadge({ modelId, providerId, reason }: RoutingBadgeProps) {
  const modelLabel = providerId ? `${modelId} (${providerId})` : modelId

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/20 mb-1.5 w-fit"
      title={`Answer model selected by LLM Router: ${modelLabel}${reason ? ` · ${reason}` : ''}`}
    >
      <Route className="size-3 text-amber-600 dark:text-amber-400 shrink-0" />
      <span className="text-[11px] text-amber-700 dark:text-amber-300 font-medium truncate max-w-[250px]">
        {modelLabel}
      </span>
      {reason && reason !== 'routed' && (
        <>
          <span className="text-[11px] text-amber-600/50 dark:text-amber-400/50">
            ·
          </span>
          <span className="text-[11px] text-amber-600/70 dark:text-amber-400/70 truncate max-w-[150px]">
            {reason}
          </span>
        </>
      )}
    </div>
  )
}
