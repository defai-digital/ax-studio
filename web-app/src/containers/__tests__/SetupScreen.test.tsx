import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SetupScreen } from '../SetupScreen'

// ── Mocks ────────────────────────────────────────────────

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? _key,
  }),
}))

vi.mock('@/containers/HeaderPage', () => ({
  HeaderPage: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="header-page">{children}</div>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

// motion/react mock — render children immediately, no animations
vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    h1: ({ children, ...props }: any) => <h1 {...props}>{children}</h1>,
    p: ({ children, ...props }: any) => <p {...props}>{children}</p>,
    button: ({ children, onClick, ...props }: any) => (
      <button onClick={onClick} {...props}>
        {children}
      </button>
    ),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    setupCompleted: 'setup-completed',
    workspaceMode: 'workspace-mode',
  },
}))

// ── Helpers ──────────────────────────────────────────────

function renderSetup(onComplete = vi.fn()) {
  return { onComplete, ...render(<SetupScreen onComplete={onComplete} />) }
}

function clickButton(label: string) {
  const btn = screen.getByText(label, { exact: false })
  fireEvent.click(btn)
}

// ── Tests ────────────────────────────────────────────────

describe('SetupScreen — short onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('renders the onboarding wizard', () => {
    renderSetup()
    expect(screen.getByText('setup:welcome')).toBeInTheDocument()
  })

  it('navigates through 2 steps: Welcome → Ready', () => {
    renderSetup()

    // Step 0: Welcome
    expect(screen.getByText('setup:welcome')).toBeInTheDocument()
    expect(screen.getByText('setup:featureLocalModels')).toBeInTheDocument()
    expect(screen.getByText('setup:featureLightningFast')).toBeInTheDocument()
    expect(screen.getByText('setup:featurePrivateSecure')).toBeInTheDocument()
    expect(screen.getByText('setup:featureToolUse')).toBeInTheDocument()
    expect(screen.getByText('setup:privacyOneLiner')).toBeInTheDocument()

    expect(screen.getByText('common:skip')).toBeInTheDocument()
    expect(screen.getByText('common:continue')).toBeInTheDocument()

    // Step 1: Ready
    clickButton('common:continue')
    expect(screen.getByText('setup:readyTitle')).toBeInTheDocument()
    expect(screen.getByText('common:newChat')).toBeInTheDocument()
    expect(screen.getByText('common:search')).toBeInTheDocument()
    expect(
      screen.getByText('settings:shortcuts.toggleSidebar')
    ).toBeInTheDocument()
    expect(screen.getByText('⌘ N')).toBeInTheDocument()
    expect(screen.getByText('⌘ K')).toBeInTheDocument()
    expect(screen.getByText('setup:configureLater')).toBeInTheDocument()

    expect(screen.getByText('setup:getStarted')).toBeInTheDocument()
    expect(screen.queryByText('common:continue')).not.toBeInTheDocument()
  })

  it('completes setup: sets localStorage and calls onComplete', () => {
    const { onComplete } = renderSetup()

    clickButton('common:continue')
    clickButton('setup:getStarted')

    expect(localStorage.getItem('setup-completed')).toBe('true')
    expect(localStorage.getItem('workspace-mode')).toBe('developer-agent')
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('skip button completes setup immediately', () => {
    const { onComplete } = renderSetup()

    clickButton('common:skip')

    expect(localStorage.getItem('setup-completed')).toBe('true')
    expect(localStorage.getItem('workspace-mode')).toBe('developer-agent')
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('back button navigates to previous step', () => {
    renderSetup()

    clickButton('common:continue')
    expect(screen.getByText('setup:readyTitle')).toBeInTheDocument()

    clickButton('common:back')
    expect(screen.getByText('setup:welcome')).toBeInTheDocument()
  })

  it('renders 2 progress dots', () => {
    const { container } = renderSetup()
    const dotsContainer = container.querySelector('.gap-2.mb-8')
    expect(dotsContainer).toBeInTheDocument()
    const dots = dotsContainer!.querySelectorAll('.rounded-full')
    expect(dots).toHaveLength(2)
  })

  it('renders HeaderPage', () => {
    renderSetup()
    expect(screen.getByTestId('header-page')).toBeInTheDocument()
  })

  it('does not go past the last step', () => {
    renderSetup()

    clickButton('common:continue')
    expect(screen.getByText('setup:readyTitle')).toBeInTheDocument()
    expect(screen.queryByText('common:continue')).not.toBeInTheDocument()
  })
})
