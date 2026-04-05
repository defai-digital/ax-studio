import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { Fragment, useEffect, useState } from 'react'
import { Link as LinkIcon } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { INTEGRATIONS } from '@/lib/integrations-registry'
import type { Integration } from '@/lib/integrations-registry'
import { useIntegrations } from '@/hooks/integrations/useIntegrations'
import { IntegrationCard } from '@/components/integrations/IntegrationCard'
import { ConnectModal } from '@/components/integrations/ConnectModal'
import { DisconnectConfirm } from '@/components/integrations/DisconnectConfirm'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export const Route = createFileRoute(route.settings.integrations)({
  component: IntegrationsPage,
})

function IntegrationsPage() {
  const { t } = useTranslation()
  const {
    statuses,
    refreshStatuses,
    connect,
    connectOAuth,
    disconnect,
    testConnection,
  } = useIntegrations()

  const [connectModalOpen, setConnectModalOpen] = useState(false)
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false)
  const [selectedIntegration, setSelectedIntegration] =
    useState<Integration | null>(null)

  useEffect(() => {
    refreshStatuses()
  }, [refreshStatuses])

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

  const handleConfirmConnectOAuth = async (
    credentials: Record<string, string>
  ) => {
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
    } catch {
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
          <div
            className={cn(
              'flex items-center justify-between w-full mr-2 pr-3',
              !IS_MACOS && 'pr-30'
            )}
          >
            <span className="font-medium text-base font-studio">Settings</span>
          </div>
        </HeaderPage>
        <div className="flex flex-1 min-h-0">
          <SettingsMenu />
          <div
            className="flex-1 overflow-y-auto"
            style={{ scrollbarWidth: 'none' }}
          >
            <div className="flex items-center gap-3 px-8 py-5 border-b border-border/40 bg-background sticky top-0 z-10">
              <div
                className="size-7 rounded-lg flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                }}
              >
                <LinkIcon className="size-3.5 text-white" strokeWidth={2.5} />
              </div>
              <h1
                className="text-foreground tracking-tight"
                style={{ fontSize: '16px', fontWeight: 600 }}
              >
                {t('common:integrations')}
              </h1>
            </div>
            <div className="px-8 py-7">
              <div className="max-w-2xl space-y-6">
                <p className="text-sm text-muted-foreground">
                  Connect your tools with one click. Credentials are encrypted
                  and stored locally.
                </p>

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
