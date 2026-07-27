import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
}))

vi.mock('@/constants/providers', () => ({
  AX_ENGINE_PROVIDER_ID: 'ax-engine',
}))

vi.mock('@/constants/routes', () => ({
  route: {
    settings: { axEngine: '/settings/ax-engine' },
  },
}))

vi.mock('@/routes/settings/providers/$providerName', () => ({
  ProviderSettingsPage: ({ providerName }: { providerName: string }) => (
    <div>Provider settings: {providerName}</div>
  ),
}))

import { Route } from '../ax-engine'

describe('AX Engine Settings route', () => {
  it('promotes AX Engine to its own top-level Settings page', () => {
    const Component = Route.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('Provider settings: ax-engine')).toBeInTheDocument()
  })
})
