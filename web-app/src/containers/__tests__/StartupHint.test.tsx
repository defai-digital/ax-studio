import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StartupHint } from '../StartupHint'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...props
  }: {
    children: React.ReactNode
    to: string
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'setup:startupHintTitle': 'Choose your first model',
        'setup:startupHintDescription': 'Choose a local or cloud setup path.',
        'setup:browseLocalModels': 'Browse local models',
        'setup:connectCloudProvider': 'Connect cloud provider',
        'setup:dismissStartupHint': 'Dismiss startup hint',
      })[key] ?? key,
  }),
}))

describe('StartupHint', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('shows one actionable model-setup hint on first run', () => {
    render(<StartupHint />)

    expect(screen.getByText('Choose your first model')).toBeInTheDocument()
    expect(screen.getByText('Browse local models').closest('a')).toHaveAttribute(
      'href',
      '/hub/'
    )
    expect(
      screen.getByText('Connect cloud provider').closest('a')
    ).toHaveAttribute('href', '/settings/providers/')
  })

  it('persists dismissal and does not return', () => {
    const { unmount } = render(<StartupHint />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss startup hint' })
    )

    expect(localStorage.getItem('startup-hint-dismissed')).toBe('true')
    expect(localStorage.getItem('setup-completed')).toBe('true')
    expect(screen.queryByText('Choose your first model')).not.toBeInTheDocument()

    unmount()
    render(<StartupHint />)
    expect(screen.queryByText('Choose your first model')).not.toBeInTheDocument()
  })

  it('honors completion of the retired onboarding flow', () => {
    localStorage.setItem('setup-completed', 'true')

    render(<StartupHint />)

    expect(screen.queryByText('Choose your first model')).not.toBeInTheDocument()
  })
})
