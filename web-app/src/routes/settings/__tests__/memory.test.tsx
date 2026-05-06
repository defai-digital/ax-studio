import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import type { MemoryEntry } from '@/hooks/integrations/useMemory'

const mocks = vi.hoisted(() => {
  const memoryState = {} as {
    memories: Record<string, MemoryEntry[]>
    memoryEnabled: boolean
    toggleMemory: ReturnType<typeof vi.fn>
    updateMemory: ReturnType<typeof vi.fn>
    deleteMemory: ReturnType<typeof vi.fn>
    clearMemories: ReturnType<typeof vi.fn>
    importMemories: ReturnType<typeof vi.fn>
  }

  const toggleMemory = vi.fn(() => {
    memoryState.memoryEnabled = !memoryState.memoryEnabled
  })

  Object.assign(memoryState, {
    memories: {},
    memoryEnabled: false,
    toggleMemory,
    updateMemory: vi.fn(),
    deleteMemory: vi.fn(),
    clearMemories: vi.fn(),
    importMemories: vi.fn(),
  })

  return {
    createObjectURL: vi.fn(() => 'blob:ax-studio-test'),
    memoryState,
    navigate: vi.fn(),
    revokeObjectURL: vi.fn(),
    toast: {
      error: vi.fn(),
      success: vi.fn(),
    },
  }
})

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: unknown) => config,
  useNavigate: () => mocks.navigate,
}))

vi.mock('@/constants/routes', () => ({
  route: {
    settings: {
      memory: '/settings/memory',
    },
  },
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('sonner', () => ({
  toast: mocks.toast,
}))

vi.mock('lucide-react', () => ({
  Brain: () => <span data-testid="brain-icon" />,
  Check: () => <span data-testid="check-icon" />,
  Download: () => <span data-testid="download-icon" />,
  MessageSquare: () => <span data-testid="message-icon" />,
  Search: () => <span data-testid="search-icon" />,
  Trash2: () => <span data-testid="trash-icon" />,
  Upload: () => <span data-testid="upload-icon" />,
  X: () => <span data-testid="x-icon" />,
}))

vi.mock('@/components/common/SettingsMenu', () => ({
  default: () => <nav data-testid="settings-menu" />,
}))

vi.mock('@/containers/HeaderPage', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <header data-testid="header-page">{children}</header>
  ),
}))

vi.mock('@/components/settings/SettingsPageLayout', () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}))

vi.mock('@/components/common/Card', () => ({
  Card: ({
    header,
    title,
    children,
  }: {
    header?: React.ReactNode
    title?: React.ReactNode
    children?: React.ReactNode
  }) => (
    <section data-testid="card">
      {header}
      {title && <h2>{title}</h2>}
      {children}
    </section>
  ),
  CardItem: ({
    title,
    description,
    actions,
  }: {
    title?: React.ReactNode
    description?: React.ReactNode
    actions?: React.ReactNode
  }) => (
    <div data-testid="card-item">
      {title && <div>{title}</div>}
      {description && <div>{description}</div>}
      {actions}
    </div>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    onClick,
    ...props
  }: {
    children: React.ReactNode
    disabled?: boolean
    onClick?: () => void
  }) => (
    <button disabled={disabled} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ui/input', async () => {
  const React = await import('react')
  return {
    Input: React.forwardRef<
      HTMLInputElement,
      React.InputHTMLAttributes<HTMLInputElement>
    >((props, ref) => <input ref={ref} {...props} />),
  }
})

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    disabled,
    onCheckedChange,
  }: {
    checked: boolean
    disabled?: boolean
    onCheckedChange: (checked: boolean) => void
  }) => (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onCheckedChange(event.currentTarget.checked)}
    />
  ),
}))

vi.mock('@/hooks/integrations/useMemory', () => ({
  MEMORY_LIMIT: 50,
  useMemory: (selector: (state: typeof mocks.memoryState) => unknown) =>
    selector(mocks.memoryState),
}))

import { Route } from '../memory'

function makeMemory(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'mem-1',
    fact: 'User likes Rust',
    category: 'preferences',
    sourceThreadId: 'thread-1',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function renderMemoryRoute() {
  const Component = Route.component as React.ComponentType
  return render(<Component />)
}

function resetMemoryState() {
  Object.assign(mocks.memoryState, {
    memories: {},
    memoryEnabled: false,
  })
}

describe('Memory settings route', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    resetMemoryState()

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: mocks.createObjectURL,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: mocks.revokeObjectURL,
    })
  })

  it('renders the empty state and disables backup actions that require data or memory', () => {
    renderMemoryRoute()

    expect(screen.getByTestId('settings-menu')).toBeInTheDocument()
    expect(screen.getByText('common:memory')).toBeInTheDocument()
    expect(screen.getByText('Stored facts (0 / 50)')).toBeInTheDocument()
    expect(
      screen.getByText(
        'No memories yet. Enable memory and chat — personal facts will be remembered automatically.'
      )
    ).toBeInTheDocument()

    expect(screen.getByRole('button', { name: /Export/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Import/i })).toBeDisabled()
  })

  it('toggles automatic memory from the settings switch', () => {
    const { rerender } = renderMemoryRoute()

    const memorySwitch = screen.getByRole('checkbox')
    expect(memorySwitch).not.toBeChecked()

    fireEvent.click(memorySwitch)

    expect(mocks.memoryState.toggleMemory).toHaveBeenCalledTimes(1)

    const Component = Route.component as React.ComponentType
    rerender(<Component />)
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(screen.getByRole('button', { name: /Import/i })).toBeEnabled()
  })

  it('filters stored facts by fact text or category', () => {
    mocks.memoryState.memories = {
      default: [
        makeMemory(),
        makeMemory({
          id: 'mem-2',
          fact: 'User prefers TypeScript',
          category: 'engineering_tools',
          sourceThreadId: 'thread-2',
        }),
      ],
    }

    renderMemoryRoute()

    expect(screen.getByText('Stored facts (2 / 50)')).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Search memories...'), {
      target: { value: 'rust' },
    })

    expect(screen.getByText('Showing 1 of 2')).toBeInTheDocument()
    expect(screen.getByText('User likes Rust')).toBeInTheDocument()
    expect(screen.queryByText('User prefers TypeScript')).not.toBeInTheDocument()
  })

  it('edits a memory fact and saves trimmed text on blur', () => {
    mocks.memoryState.memories = {
      default: [makeMemory()],
    }

    renderMemoryRoute()
    fireEvent.click(screen.getByText('User likes Rust'))

    const editor = screen.getByDisplayValue('User likes Rust')
    fireEvent.change(editor, { target: { value: '  User likes stable Rust  ' } })
    fireEvent.blur(editor)

    expect(mocks.memoryState.updateMemory).toHaveBeenCalledWith(
      'default',
      'mem-1',
      'User likes stable Rust'
    )
  })

  it('navigates to the source thread from a memory row', () => {
    mocks.memoryState.memories = {
      default: [makeMemory()],
    }

    renderMemoryRoute()
    fireEvent.click(screen.getByTitle('Go to source thread'))

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/threads/$threadId',
      params: { threadId: 'thread-1' },
    })
  })

  it('deletes individual memories and clears all stored facts', () => {
    mocks.memoryState.memories = {
      default: [makeMemory()],
    }

    renderMemoryRoute()

    const deleteButton = screen.getByTestId('trash-icon').closest('button')
    expect(deleteButton).not.toBeNull()
    fireEvent.click(deleteButton as HTMLButtonElement)
    expect(mocks.memoryState.deleteMemory).toHaveBeenCalledWith(
      'default',
      'mem-1'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Clear All' }))
    expect(mocks.memoryState.clearMemories).toHaveBeenCalledWith('default')
  })

  it('exports current memories as a JSON backup', () => {
    mocks.memoryState.memories = {
      default: [makeMemory()],
    }

    renderMemoryRoute()

    const anchor = document.createElement('a')
    const click = vi.spyOn(anchor, 'click').mockImplementation(() => undefined)
    const appendChild = vi.spyOn(document.body, 'appendChild')
    const removeChild = vi.spyOn(document.body, 'removeChild')
    const createElement = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(anchor)

    fireEvent.click(screen.getByRole('button', { name: /Export/i }))

    expect(mocks.createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(appendChild).toHaveBeenCalledWith(anchor)
    expect(click).toHaveBeenCalledTimes(1)
    expect(removeChild).toHaveBeenCalledWith(anchor)
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith('blob:ax-studio-test')
    expect(mocks.toast.success).toHaveBeenCalledWith('Exported 1 memories')

    createElement.mockRestore()
    appendChild.mockRestore()
    removeChild.mockRestore()
  })

  it('imports a valid JSON backup file', async () => {
    mocks.memoryState.memoryEnabled = true
    const imported = [
      makeMemory({
        id: 'mem-imported',
        fact: 'Imported memory',
        sourceThreadId: 'thread-imported',
      }),
    ]

    const { container } = renderMemoryRoute()
    const input = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement

    fireEvent.change(input, {
      target: {
        files: [
          new File([JSON.stringify(imported)], 'memories.json', {
            type: 'application/json',
          }),
        ],
      },
    })

    await waitFor(() => {
      expect(mocks.memoryState.importMemories).toHaveBeenCalledWith(
        'default',
        imported
      )
    })
    expect(mocks.toast.success).toHaveBeenCalledWith('Imported 1 memories')
  })
})
