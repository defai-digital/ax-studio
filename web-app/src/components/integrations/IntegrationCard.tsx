import { Button } from '@/components/ui/button'
import type { Integration } from '@/lib/integrations-registry'
import type { IntegrationStatus } from '@/hooks/useIntegrations'
import { cn } from '@/lib/utils'

type Props = {
  integration: Integration
  status: IntegrationStatus
  onConnect: () => void
  onDisconnect: () => void
}

const statusConfig: Record<IntegrationStatus, { label: string; color: string }> = {
  idle: { label: 'Not connected', color: 'bg-muted-foreground/40' },
  connecting: { label: 'Connecting...', color: 'bg-yellow-500' },
  connected: { label: 'Connected', color: 'bg-green-500' },
  error: { label: 'Error', color: 'bg-red-500' },
}

export function IntegrationCard({ integration, status, onConnect, onDisconnect }: Props) {
  const { label, color } = statusConfig[status]
  const isConnected = status === 'connected'

  return (
    <div className="flex items-center justify-between p-4 rounded-lg border bg-card">
      <div className="flex items-center gap-3 min-w-0">
        <img
          src={integration.icon}
          alt={integration.name}
          className="w-8 h-8 shrink-0 dark:invert-[0.85]"
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-sm">{integration.name}</h3>
            <div className="flex items-center gap-1.5">
              <div className={cn('size-2 rounded-full', color)} />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {integration.description}
          </p>
        </div>
      </div>
      <div className="shrink-0 ml-4">
        {isConnected ? (
          <Button variant="outline" size="sm" onClick={onDisconnect}>
            Disconnect
          </Button>
        ) : (
          <Button variant="default" size="sm" onClick={onConnect}>
            Connect
          </Button>
        )}
      </div>
    </div>
  )
}
