import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import SetupScreen from './SetupScreen'

// ── Mocks ────────────────────────────────────────────────

const mockSetTheme = vi.fn()
const mockUpdateProvider = vi.fn()

vi.mock('@/hooks/useTheme', () => ({
  useTheme: vi.fn(() => ({
    activeTheme: 'auto',
    setTheme: mockSetTheme,
    isDark: true,
    setIsDark: vi.fn(),
  })),
}))

vi.mock('@/features/models/hooks/useModelProvider', () => ({
  useModelProvider: vi.fn(() => ({
    providers: [
      { provider: 'llamacpp', active: true },
      { provider: 'openai', active: false },
      { provider: 'anthropic', active: true },
      { provider: 'groq', active: false },
      { provider: 'google', active: false },
    ],
    updateProvider: mockUpdateProvider,
    selectedProvider: '',
    selectedModel: null,
    setProviders: vi.fn(),
    addProvider: vi.fn(),
  })),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key,
  }),
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="header-page">{children}</div>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>{children}</button>
  ),
}))

// motion/react mock — render children immediately, no animations
vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    h1: ({ children, ...props }: any) => <h1 {...props}>{children}</h1>,
    p: ({ children, ...props }: any) => <p {...props}>{children}</p>,
    button: ({ children, onClick, ...props }: any) => (
      <button onClick={onClick} {...props}>{children}</button>
    ),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

vi.mock('@/constants/localStorage', () => ({
  localStorageKey: {
    setupCompleted: 'setup-completed',
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

describe('SetupScreen — Manual Test Protocol', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  // Protocol #1: First-run onboarding renders
  it('renders the onboarding wizard', () => {
    renderSetup()
    expect(screen.getByText('Welcome to Ax-Studio')).toBeInTheDocument()
  })

  // Protocol #2: Navigate through all 5 steps
  it('navigates through all 5 steps: Welcome → Theme → Providers → Privacy → Ready', () => {
    renderSetup()

    // Step 0: Welcome
    expect(screen.getByText('Welcome to Ax-Studio')).toBeInTheDocument()
    expect(screen.getByText('Local AI Models')).toBeInTheDocument()
    expect(screen.getByText('Lightning Fast')).toBeInTheDocument()
    expect(screen.getByText('Private & Secure')).toBeInTheDocument()
    expect(screen.getByText('Tool Use & MCP')).toBeInTheDocument()

    // Step 0 has Skip button (not Back)
    expect(screen.getByText('Skip')).toBeInTheDocument()
    expect(screen.getByText('Continue')).toBeInTheDocument()

    // Navigate to Step 1: Theme
    clickButton('Continue')
    expect(screen.getByText('Choose your theme')).toBeInTheDocument()
    expect(screen.getByText('Light')).toBeInTheDocument()
    expect(screen.getByText('Dark')).toBeInTheDocument()
    expect(screen.getByText('System')).toBeInTheDocument()

    // Now has Back button instead of Skip
    expect(screen.getByText('Back')).toBeInTheDocument()

    // Navigate to Step 2: Providers
    clickButton('Continue')
    expect(screen.getByText('Set up providers')).toBeInTheDocument()
    expect(screen.getByText('Local (LlamaCPP)')).toBeInTheDocument()
    expect(screen.getByText('OpenAI')).toBeInTheDocument()
    expect(screen.getByText('Anthropic')).toBeInTheDocument()
    expect(screen.getByText('Groq')).toBeInTheDocument()
    expect(screen.getByText('Google Gemini')).toBeInTheDocument()
    expect(screen.getByText('Recommended')).toBeInTheDocument()

    // Navigate to Step 3: Privacy
    clickButton('Continue')
    expect(screen.getByText('Your privacy matters')).toBeInTheDocument()
    expect(screen.getByText('Local-first')).toBeInTheDocument()
    expect(screen.getByText('No telemetry')).toBeInTheDocument()
    expect(screen.getByText('Your keys, your control')).toBeInTheDocument()
    expect(screen.getByText('Open source')).toBeInTheDocument()

    // Navigate to Step 4: Ready
    clickButton('Continue')
    expect(screen.getByText("You're all set!")).toBeInTheDocument()
    expect(screen.getByText('New chat')).toBeInTheDocument()
    expect(screen.getByText('Search')).toBeInTheDocument()
    expect(screen.getByText('New project')).toBeInTheDocument()
    expect(screen.getByText('Toggle sidebar')).toBeInTheDocument()
    expect(screen.getByText('⌘ N')).toBeInTheDocument()
    expect(screen.getByText('⌘ K')).toBeInTheDocument()

    // Final step shows "Get Started" instead of "Continue"
    expect(screen.getByText('Get Started')).toBeInTheDocument()
    expect(screen.queryByText('Continue')).not.toBeInTheDocument()
  })

  // Protocol #3: Theme step applies immediately
  it('calls setTheme when a theme option is clicked', () => {
    renderSetup()
    clickButton('Continue') // Go to Theme step

    fireEvent.click(screen.getByText('Dark'))
    expect(mockSetTheme).toHaveBeenCalledWith('dark')

    fireEvent.click(screen.getByText('Light'))
    expect(mockSetTheme).toHaveBeenCalledWith('light')

    fireEvent.click(screen.getByText('System'))
    expect(mockSetTheme).toHaveBeenCalledWith('auto')
  })

  // Protocol #4: Providers step toggles
  it('calls updateProvider when a provider is toggled', () => {
    renderSetup()
    clickButton('Continue') // Theme
    clickButton('Continue') // Providers

    // Click OpenAI (currently inactive, should toggle to active)
    fireEvent.click(screen.getByText('OpenAI'))
    expect(mockUpdateProvider).toHaveBeenCalledWith('openai', { active: true })

    // Click LlamaCPP (currently active, should toggle to inactive)
    fireEvent.click(screen.getByText('Local (LlamaCPP)'))
    expect(mockUpdateProvider).toHaveBeenCalledWith('llamacpp', { active: false })
  })

  // Protocol #5: Get Started sets localStorage and calls onComplete
  it('completes setup: sets localStorage and calls onComplete', () => {
    const { onComplete } = renderSetup()

    // Navigate to final step
    clickButton('Continue') // 1
    clickButton('Continue') // 2
    clickButton('Continue') // 3
    clickButton('Continue') // 4

    clickButton('Get Started')

    expect(localStorage.getItem('setup-completed')).toBe('true')
    expect(onComplete).toHaveBeenCalledOnce()
  })

  // Protocol #1 variant: Skip button on step 0 also completes setup
  it('skip button completes setup immediately', () => {
    const { onComplete } = renderSetup()

    clickButton('Skip')

    expect(localStorage.getItem('setup-completed')).toBe('true')
    expect(onComplete).toHaveBeenCalledOnce()
  })

  // Back navigation works
  it('back button navigates to previous step', () => {
    renderSetup()

    clickButton('Continue') // Go to Theme
    expect(screen.getByText('Choose your theme')).toBeInTheDocument()

    clickButton('Back') // Back to Welcome
    expect(screen.getByText('Welcome to Ax-Studio')).toBeInTheDocument()
  })

  // Progress dots: 5 dots rendered
  it('renders 5 progress dots', () => {
    const { container } = renderSetup()
    // Progress dots are in the first flex gap-2 mb-8 container
    const dotsContainer = container.querySelector('.gap-2.mb-8')
    expect(dotsContainer).toBeInTheDocument()
    const dots = dotsContainer!.querySelectorAll('.rounded-full')
    expect(dots).toHaveLength(5)
  })

  // HeaderPage is rendered
  it('renders HeaderPage', () => {
    renderSetup()
    expect(screen.getByTestId('header-page')).toBeInTheDocument()
  })

  // Cannot go past step 4 or before step 0
  it('does not go past the last step or before the first step', () => {
    renderSetup()

    // Navigate to last step
    clickButton('Continue') // 1
    clickButton('Continue') // 2
    clickButton('Continue') // 3
    clickButton('Continue') // 4

    expect(screen.getByText("You're all set!")).toBeInTheDocument()
    // No "Continue" button on last step — only "Get Started"
    expect(screen.queryByText('Continue')).not.toBeInTheDocument()
  })
})
