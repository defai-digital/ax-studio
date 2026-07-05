import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { AxBiWorkspace } from '@/containers/AxBiWorkspace'

export const Route = createFileRoute(route.axBi)({
  component: AxBiWorkspace,
})
