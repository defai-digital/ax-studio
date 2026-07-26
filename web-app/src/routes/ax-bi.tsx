import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import { AxBiHistory } from '@/containers/AxBiHistory'

function AxBiPage() {
  // Chat-first (migration matrix §4): the page is a slim run-history view
  // plus the zero-config connect card.
  return <AxBiHistory />
}

export const Route = createFileRoute(route.axBi)({
  component: AxBiPage,
})
