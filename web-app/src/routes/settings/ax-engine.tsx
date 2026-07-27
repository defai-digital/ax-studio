import { createFileRoute } from '@tanstack/react-router'
import { AX_ENGINE_PROVIDER_ID } from '@/constants/providers'
import { route } from '@/constants/routes'
import { ProviderSettingsPage } from '@/routes/settings/providers/$providerName'

export const Route = createFileRoute(route.settings.axEngine)({
  component: AxEngineSettings,
})

function AxEngineSettings() {
  return <ProviderSettingsPage providerName={AX_ENGINE_PROVIDER_ID} />
}
