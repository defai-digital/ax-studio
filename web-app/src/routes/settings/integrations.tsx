import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { Fragment, useEffect, useState } from 'react'
import { INTEGRATIONS } from '@/lib/integrations-registry'
import type { Integration } from '@/lib/integrations-registry'
import { useIntegrations } from '@/hooks/useIntegrations'
import { IntegrationCard } from '@/components/integrations/IntegrationCard'
import { ConnectModal } from '@/components/integrations/ConnectModal'
import { DisconnectConfirm } from '@/components/integrations/DisconnectConfirm'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.integrations as any)({
  component: IntegrationsPage,
})

function IntegrationsPage() {
  const { statuses, refreshStatuses, connect, connectOAuth, disconnect, testConnection } = useIntegrations()

  const [connectModalOpen, setConnectModalOpen] = useState(false)
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false)
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null)

  useEffect(() => {
    refreshStatuses()
  }, [])

  const handleConnect = (integration: Integration) => {
    setSelectedIntegration(integration)
    setConnectModalOpen(true)
  }

  const handleDisconnect = (integration: Integration) => {
    setSelectedIntegration(integration)
    setDisconnectDialogOpen(true)
  }

  const handleConfirmConnect = async (credentials: Record<string, string>) => {
    if (!selectedIntegration) return
    await connect(selectedIntegration.id, credentials)
    toast.success(`${selectedIntegration.name} connected successfully`)
    refreshStatuses()
  }

  const handleConfirmConnectOAuth = async (credentials: Record<string, string>) => {
    if (!selectedIntegration) return
    await connectOAuth(selectedIntegration.id, credentials)
    toast.success(`${selectedIntegration.name} connected successfully`)
    refreshStatuses()
  }

  const handleConfirmDisconnect = async () => {
    if (!selectedIntegration) return
    try {
      await disconnect(selectedIntegration.id)
      toast.success(`${selectedIntegration.name} disconnected`)
      refreshStatuses()
    } catch (error) {
      toast.error(`Failed to disconnect ${selectedIntegration.name}`)
    }
  }

  const handleTestConnection = async (credentials: Record<string, string>) => {
    if (!selectedIntegration) throw new Error('No integration selected')
    return await testConnection(selectedIntegration.id, credentials)
  }

  return (
    <Fragment>
      <div className="flex flex-col h-svh w-full">
        <HeaderPage>
          <div className={cn("flex items-center justify-between w-full mr-2 pr-3", !IS_MACOS && "pr-30")}>
            <span className="font-medium text-base font-studio">Settings</span>
          </div>
        </HeaderPage>
        <div className="flex h-[calc(100%-60px)]">
          <SettingsMenu />
          <div className="p-4 pt-0 w-full overflow-y-auto">
            <div className="flex flex-col gap-3 w-full">
              <div className="flex flex-col mb-2">
                <h1 className="text-foreground font-medium text-base font-studio">
                  Integrations
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Connect your tools with one click. Credentials are encrypted and stored locally.
                </p>
              </div>

              {INTEGRATIONS.map((integration) => (
                <IntegrationCard
                  key={integration.id}
                  integration={integration}
                  status={statuses[integration.id] ?? 'idle'}
                  onConnect={() => handleConnect(integration)}
                  onDisconnect={() => handleDisconnect(integration)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {selectedIntegration && (
        <>
          <ConnectModal
            open={connectModalOpen}
            onOpenChange={setConnectModalOpen}
            integration={selectedIntegration}
            onConnect={handleConfirmConnect}
            onConnectOAuth={handleConfirmConnectOAuth}
            onTest={handleTestConnection}
          />
          <DisconnectConfirm
            open={disconnectDialogOpen}
            onOpenChange={setDisconnectDialogOpen}
            integrationName={selectedIntegration.name}
            onConfirm={handleConfirmDisconnect}
          />
        </>
      )}
    </Fragment>
  )
}
