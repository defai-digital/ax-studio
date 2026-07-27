import { createFileRoute, redirect } from '@tanstack/react-router'
import { route } from '@/constants/routes'

/** Preserve old bookmarks after AX BI connection management moved to Settings. */
export const Route = createFileRoute(route.legacyAxBi)({
  beforeLoad: () => {
    throw redirect({ to: route.settings.axBi })
  },
})
