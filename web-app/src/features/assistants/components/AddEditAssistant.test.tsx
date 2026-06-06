import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AddEditAssistant from './AddEditAssistant'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ isDark: false }),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
  isDev: () => false,
}))

vi.mock('@/utils/teamEmoji', () => ({
  teamEmoji: [],
}))

vi.mock('@/lib/predefinedParams', () => ({
  paramsSettings: {},
}))

vi.mock('emoji-picker-react', () => ({
  default: () => null,
  Theme: {},
}))

vi.mock('@tabler/icons-react', () => ({
  IconPlus: () => <span data-testid="icon-plus" />,
  IconTrash: () => <span data-testid="icon-trash" />,
  IconChevronDown: () => <span />,
  IconMoodSmile: () => <span data-testid="icon-mood" />,
}))

vi.mock('@/containers/AvatarEmoji', () => ({
  AvatarEmoji: () => <span data-testid="avatar-emoji" />,
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2 data-testid="dialog-title">{children}</h2>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: Record<string, unknown>) => (
    <button onClick={onClick as () => void} {...props}>{children as React.ReactNode}</button>
  ),
}))

vi.mock('@/components/ui/input', () => ({
  Input: ({ value, onChange, placeholder, ...props }: Record<string, unknown>) => (
    <input
      value={value as string}
      onChange={onChange as React.ChangeEventHandler<HTMLInputElement>}
      placeholder={placeholder as string}
      {...props}
    />
  ),
}))

vi.mock('@/components/ui/textarea', () => ({
  Textarea: ({ value, onChange, placeholder, ...props }: Record<string, unknown>) => (
    <textarea
      value={value as string}
      onChange={onChange as React.ChangeEventHandler<HTMLTextAreaElement>}
      placeholder={placeholder as string}
      {...props}
    />
  ),
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children, onClick }: Record<string, unknown>) => (
    <div onClick={onClick as () => void}>{children as React.ReactNode}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe('AddEditAssistant', () => {
  const mockOnSave = vi.fn()
  const mockOnOpenChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders add mode title when editingKey is null', () => {
    render(
      <AddEditAssistant
        open={true}
        onOpenChange={mockOnOpenChange}
        editingKey={null}
        onSave={mockOnSave}
      />
    )
    expect(screen.getByTestId('dialog-title').textContent).toBe(
      'assistants:addAssistant'
    )
  })

  it('renders edit mode title when editingKey is provided', () => {
    render(
      <AddEditAssistant
        open={true}
        onOpenChange={mockOnOpenChange}
        editingKey="assistant-1"
        initialData={{
          id: 'assistant-1',
          name: 'Test Assistant',
          instructions: 'Test instructions',
          parameters: {},
          created_at: Date.now(),
        }}
        onSave={mockOnSave}
      />
    )
    expect(screen.getByTestId('dialog-title').textContent).toBe(
      'assistants:editAssistant'
    )
  })

  it('does not render when closed', () => {
    render(
      <AddEditAssistant
        open={false}
        onOpenChange={mockOnOpenChange}
        editingKey={null}
        onSave={mockOnSave}
      />
    )
    expect(screen.queryByTestId('dialog')).toBeNull()
  })

  it('shows name validation error when saving with empty name', () => {
    render(
      <AddEditAssistant
        open={true}
        onOpenChange={mockOnOpenChange}
        editingKey={null}
        onSave={mockOnSave}
      />
    )
    fireEvent.click(screen.getByText('assistants:save'))
    expect(screen.getByText('assistants:nameRequired')).toBeInTheDocument()
    expect(mockOnSave).not.toHaveBeenCalled()
  })

  it('calls onSave with assistant data when name is provided', () => {
    render(
      <AddEditAssistant
        open={true}
        onOpenChange={mockOnOpenChange}
        editingKey={null}
        onSave={mockOnSave}
      />
    )
    const nameInput = screen.getByPlaceholderText('assistants:enterName')
    fireEvent.change(nameInput, { target: { value: 'My Assistant' } })
    fireEvent.click(screen.getByText('assistants:save'))
    expect(mockOnSave).toHaveBeenCalledOnce()
    expect(mockOnSave.mock.calls[0][0].name).toBe('My Assistant')
  })

  it('clears name error when user types', () => {
    render(
      <AddEditAssistant
        open={true}
        onOpenChange={mockOnOpenChange}
        editingKey={null}
        onSave={mockOnSave}
      />
    )
    fireEvent.click(screen.getByText('assistants:save'))
    expect(screen.getByText('assistants:nameRequired')).toBeInTheDocument()

    const nameInput = screen.getByPlaceholderText('assistants:enterName')
    fireEvent.change(nameInput, { target: { value: 'A' } })
    expect(screen.queryByText('assistants:nameRequired')).toBeNull()
  })

  it('populates form fields in edit mode', () => {
    render(
      <AddEditAssistant
        open={true}
        onOpenChange={mockOnOpenChange}
        editingKey="assistant-1"
        initialData={{
          id: 'assistant-1',
          name: 'Edit Name',
          description: 'Edit Desc',
          instructions: 'Edit Instructions',
          parameters: {},
          created_at: Date.now(),
        }}
        onSave={mockOnSave}
      />
    )
    expect(
      (screen.getByPlaceholderText('assistants:enterName') as HTMLInputElement).value
    ).toBe('Edit Name')
  })
})
