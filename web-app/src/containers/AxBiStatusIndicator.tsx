import { useNavigate } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { cn } from '@/lib/utils'
import {
  useAxBiConnection,
  type AxBiConnectionStatus,
} from '@/stores/ax-bi-connection-store'

const STATUS_PRESENTATION: Record<
  AxBiConnectionStatus,
  { dot: string; label: string } | null
> = {
  unknown: null,
  connecting: {
    dot: 'bg-muted-foreground animate-pulse',
    label: 'AX BI connecting…',
  },
  connected: { dot: 'bg-emerald-500', label: 'AX BI connected' },
  'needs-key': { dot: 'bg-amber-500', label: 'AX BI needs an API key' },
  unreachable: {
    dot: 'bg-amber-500',
    label: 'AX BI unreachable — start the AX BI server',
  },
}

/**
 * Subtle inline AX BI status shown near the chat input (Electron only; the
 * caller gates on `isPlatformElectron()`). Clicking opens the `/ax-bi` page,
 * which carries the connect card when a key is missing.
 */
export function AxBiStatusIndicator() {
  const navigate = useNavigate()
  const status = useAxBiConnection((state) => state.status)
  const presentation = STATUS_PRESENTATION[status]
  if (!presentation) return null

  return (
    <button
      type="button"
      data-testid="ax-bi-status-indicator"
      className="mt-1.5 flex items-center gap-1.5 px-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      onClick={() => navigate({ to: route.axBi })}
    >
      <span className={cn('size-1.5 rounded-full', presentation.dot)} />
      {presentation.label}
    </button>
  )
}
