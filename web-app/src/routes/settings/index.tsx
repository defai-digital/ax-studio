import { createFileRoute, redirect } from '@tanstack/react-router'
import { route } from '@/constants/routes'

// `/settings` has no page of its own — always land on the General tab.
export const Route = createFileRoute('/settings/')({
  beforeLoad: () => {
    throw redirect({ to: route.settings.general })
  },
})
