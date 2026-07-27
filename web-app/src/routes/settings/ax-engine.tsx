import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { AxEngineConnectionSettings } from '@/containers/AxEngineConnectionSettings'

export const Route = createFileRoute(route.settings.axEngine)({
  component: AxEngineSettings,
})

function AxEngineSettings() {
  return <AxEngineConnectionSettings />
}
