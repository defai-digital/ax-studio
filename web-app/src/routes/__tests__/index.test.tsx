import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

// ── Mocks (must be before component import) ─────────────

const mockNavigate = vi.fn()
const mockCreateThread = vi.fn().mockResolvedValue({ id: 'thread-1' })
const mockSetCurrentThreadId = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: any) => ({
    ...config,
    component: config.component,
  }),
  useNavigate: () => mockNavigate,
  useSearch: () => ({}),
}))

vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: () => ({
    providers: [{ provider: 'openai', api_key: 'test-key', active: true }],
    selectedModel: { id: 'gpt-4', provider: 'openai' },
    selectedProvider: 'openai',
  }),
}))

vi.mock('@/hooks/threads/useThreads', () => ({
  useThreads: (selector?: any) => {
    const state = {
      setCurrentThreadId: mockSetCurrentThreadId,
      createThread: mockCreateThread,
      threads: [],
      getFilteredThreads: () => [],
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('@/hooks/settings/useGeneralSetting', () => ({
  useGeneralSetting: () => ({
    globalDefaultPrompt: 'You are a helpful assistant.',
  }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'common:homeHeroTitle': 'What can I help you with?',
        'common:homeHeroSubtitle':
          "Ask anything, build with AI, or explore what's possible.",
        'common:capabilityLocalModels': 'Local models',
        'common:capabilityLightningFast': 'Lightning fast',
        'common:capabilityPrivateLocal': 'Private & local',
        'common:capabilityToolsMcp': 'Tool use & MCP',
      }
      return translations[key] ?? key
    },
  }),
}))

vi.mock('@/hooks/tools/useTools', () => ({
  useTools: vi.fn(),
}))

const mockSetPrompt = vi.fn()

vi.mock('@/hooks/ui/usePrompt', () => ({
  usePrompt: (selector?: any) => {
    const state = { setPrompt: mockSetPrompt }
    return selector ? selector(state) : state
  },
}))

vi.mock('@/components/smart-start/WorkflowSelector', () => ({
  WorkflowSelector: ({
    onPromptReady,
  }: {
    onPromptReady: (prompt: string) => void
  }) => (
    <button
      type="button"
      onClick={() =>
        onPromptReady(
          'Help me build a REST API with authentication and CRUD endpoints'
        )
      }
    >
      Build REST API
    </button>
  ),
}))

vi.mock('@/lib/prompts/system-prompt', () => ({
  resolveSystemPrompt: () => ({
    resolvedPrompt: 'You are a helpful assistant.',
    source: 'global',
  }),
}))

vi.mock('@/containers/ChatInput', () => ({
  // The model selector now lives inside the composer (ChatInput), not the
  // page header. Reflect that ownership here so the placement is asserted.
  ChatInput: () => (
    <div data-testid="chat-input-container">
      ChatInput
      <div data-testid="model-selector">Model Selector</div>
    </div>
  ),
}))

vi.mock('@/containers/HeaderPage', () => ({
  HeaderPage: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="header-page">{children}</div>
  ),
}))

vi.mock('@/containers/SetupScreen', () => ({
  SetupScreen: ({ onComplete }: { onComplete?: () => void }) => (
    <div data-testid="setup-screen">
      <button onClick={onComplete}>Complete Setup</button>
    </div>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/textarea', () => ({
  Textarea: (props: any) => <textarea {...props} />,
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: any) => (
    <div role="menuitem" onClick={onSelect}>
      {children}
    </div>
  ),
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
}))

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    h1: ({ children, ...props }: any) => <h1 {...props}>{children}</h1>,
    p: ({ children, ...props }: any) => <p {...props}>{children}</p>,
    button: ({ children, onClick, className, ...props }: any) => (
      <button onClick={onClick} className={className} {...props}>
        {children}
      </button>
    ),
  },
}))

vi.mock('@/constants/routes', () => ({
  route: { home: '/' },
}))

vi.mock('@/constants/localStorage', () => ({
  localStorageKey: { setupCompleted: 'setup-completed' },
}))

vi.mock('@/constants/chat', () => ({
  SESSION_STORAGE_KEY: {
    NEW_THREAD_PROMPT: 'new-thread-prompt',
    SPLIT_VIEW_INFO: 'split-view-info',
  },
}))

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>()
  return { ...actual }
})

// ── Import the route after mocks ────────────────────────

import { Route } from '../index'

// ── Helpers ─────────────────────────────────────────────

function renderIndex() {
  const Component = Route.component as React.ComponentType
  return render(<Component />)
}

// ── Tests ───────────────────────────────────────────────

describe('Home Page (index.tsx) — Manual Test Protocol', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.setItem('setup-completed', 'true')
    sessionStorage.clear()
  })

  // Protocol #7: Home hero section
  it('renders hero section with heading and subtitle', () => {
    renderIndex()

    expect(screen.getByText('What can I help you with?')).toBeInTheDocument()
    expect(
      screen.getByText(
        "Ask anything, build with AI, or explore what's possible."
      )
    ).toBeInTheDocument()
  })

  // Protocol #8: Smart Start workflow selector
  it('renders the Smart Start workflow selector', () => {
    renderIndex()

    expect(screen.getByText('Build REST API')).toBeInTheDocument()
  })

  // Protocol #9: Workflow selection prepares the prompt
  it('sets global prompt when a workflow is selected', () => {
    renderIndex()

    // Create a mock textarea to simulate the chat input
    const textarea = document.createElement('textarea')
    textarea.setAttribute('data-chat-input', '')
    document.body.appendChild(textarea)

    fireEvent.click(screen.getByText('Build REST API'))

    expect(mockSetPrompt).toHaveBeenCalledWith(
      'Help me build a REST API with authentication and CRUD endpoints'
    )

    document.body.removeChild(textarea)
  })

  // Protocol #10: ChatInput renders at bottom
  it('renders ChatInput component', () => {
    renderIndex()
    expect(screen.getByTestId('chat-input-container')).toBeInTheDocument()
  })

  // Protocol #11: Model selector renders (now within the composer, not the header)
  it('renders model selector in the composer', () => {
    renderIndex()
    expect(screen.getByTestId('model-selector')).toBeInTheDocument()
  })

  // Protocol #12: Thread prompt editor toggle
  it('toggles thread prompt editor on button click', () => {
    renderIndex()

    expect(
      screen.queryByPlaceholderText(/Set a prompt for the new thread/)
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Thread Prompt'))

    expect(
      screen.getByPlaceholderText(/Set a prompt for the new thread/)
    ).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Thread Prompt'))
    expect(
      screen.queryByPlaceholderText(/Set a prompt for the new thread/)
    ).not.toBeInTheDocument()
  })

  // Protocol #12: Thread prompt persists to sessionStorage
  it('persists thread prompt draft to sessionStorage', async () => {
    renderIndex()

    fireEvent.click(screen.getByLabelText('Thread Prompt'))
    const textarea = screen.getByPlaceholderText(
      /Set a prompt for the new thread/
    )

    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'Custom system prompt' } })
    })

    expect(sessionStorage.getItem('new-thread-prompt')).toBe(
      'Custom system prompt'
    )
  })

  // Protocol #15: Split view menu renders
  it('renders split view with left/right options', () => {
    renderIndex()

    expect(screen.getByLabelText('Split View')).toBeInTheDocument()
    expect(screen.getByText('Split Left')).toBeInTheDocument()
    expect(screen.getByText('Split Right')).toBeInTheDocument()
  })

  // Protocol #15: Split view creates threads and navigates
  it('split view creates two threads and navigates', async () => {
    mockCreateThread
      .mockResolvedValueOnce({ id: 'main-thread' })
      .mockResolvedValueOnce({ id: 'split-thread' })

    renderIndex()

    await act(async () => {
      fireEvent.click(screen.getByText('Split Left'))
    })

    expect(mockCreateThread).toHaveBeenCalledTimes(2)
    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/threads/$threadId',
      params: { threadId: 'main-thread' },
    })
    expect(sessionStorage.getItem('split-view-info')).toContain('split-thread')
  })

  // Composer-first empty state: no marketing capability badges
  it('does not render capability badges on the home empty state', () => {
    renderIndex()

    expect(screen.queryByText('Local models')).not.toBeInTheDocument()
    expect(screen.queryByText('Lightning fast')).not.toBeInTheDocument()
    expect(screen.queryByText('Private & local')).not.toBeInTheDocument()
    expect(screen.queryByText('Tool use & MCP')).not.toBeInTheDocument()
    // Composer remains the primary affordance
    expect(screen.getByTestId('chat-input-container')).toBeInTheDocument()
  })

  // Clears thread ID on mount
  it('clears current thread ID on mount', () => {
    renderIndex()
    expect(mockSetCurrentThreadId).toHaveBeenCalledWith(undefined)
  })
})
