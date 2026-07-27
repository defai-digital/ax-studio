import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => config,
}))

vi.mock('@/constants/routes', () => ({
  route: {
    settings: { axBi: '/settings/ax-bi' },
  },
}))

vi.mock('@/components/common/SettingsMenu', () => ({
  SettingsMenu: () => <nav>Settings menu</nav>,
}))

vi.mock('@/components/settings/SettingsPageLayout', () => ({
  SettingsPageLayout: ({ title }: { title: React.ReactNode }) => (
    <header>{title}</header>
  ),
}))

vi.mock('@/containers/HeaderPage', () => ({
  HeaderPage: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock('@/containers/AxBiConnectCard', () => ({
  AxBiConnectCard: () => <div>AX BI connection controls</div>,
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({ 'common:axBi': 'AX BI', 'common:settings': 'Settings' })[key] ?? key,
  }),
}))

import { Route } from '../ax-bi'

describe('AX BI Settings route', () => {
  it('keeps connection management in Settings and points users to chat', () => {
    const Component = Route.component as React.ComponentType
    render(<Component />)

    expect(screen.getByText('AX BI connection controls')).toBeInTheDocument()
    expect(screen.getByText(/AX BI works through chat/)).toBeInTheDocument()
    expect(screen.getByText('Use AX BI from chat')).toBeInTheDocument()
  })
})
