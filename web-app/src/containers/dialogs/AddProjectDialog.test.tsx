import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AddProjectDialog from './AddProjectDialog'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.defaultValue ? String(opts.defaultValue) : key,
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/features/threads/hooks/useThreadManagement', () => ({
  useThreadManagement: () => ({
    folders: [],
  }),
}))

vi.mock('@/features/assistants/hooks/useAssistant', () => ({
  useAssistant: () => ({
    assistants: [],
    addAssistant: vi.fn(),
  }),
}))

vi.mock('lucide-react', () => ({
  ChevronDown: () => <span />,
  Plus: () => <span />,
}))

vi.mock('@/containers/AvatarEmoji', () => ({
  AvatarEmoji: () => <span />,
}))

vi.mock('./AddEditAssistant', () => ({
  default: () => null,
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
  Button: ({ children, onClick, disabled, ...props }: Record<string, unknown>) => (
    <button
      onClick={onClick as () => void}
      disabled={disabled as boolean}
      {...props}
    >
      {children as React.ReactNode}
    </button>
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
  DropdownMenuItem: ({ children, onSelect }: Record<string, unknown>) => (
    <div onClick={onSelect as () => void}>{children as React.ReactNode}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe('AddProjectDialog', () => {
  const mockOnSave = vi.fn()
  const mockOnOpenChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders create title when editingKey is null', () => {
    render(
      <AddProjectDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        editingKey={null}
        onSave={mockOnSave}
      />
    )
    expect(screen.getByTestId('dialog-title').textContent).toBe(
      'projects.addProjectDialog.createTitle'
    )
  })

  it('renders edit title when editingKey is set', () => {
    render(
      <AddProjectDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        editingKey="proj-1"
        initialData={{
          id: 'proj-1',
          name: 'Test Project',
          updated_at: Date.now(),
        }}
        onSave={mockOnSave}
      />
    )
    expect(screen.getByTestId('dialog-title').textContent).toBe(
      'projects.addProjectDialog.editTitle'
    )
  })

  it('does not render when closed', () => {
    render(
      <AddProjectDialog
        open={false}
        onOpenChange={mockOnOpenChange}
        editingKey={null}
        onSave={mockOnSave}
      />
    )
    expect(screen.queryByTestId('dialog')).toBeNull()
  })

  it('calls onSave with project name when form is submitted', () => {
    render(
      <AddProjectDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        editingKey={null}
        onSave={mockOnSave}
      />
    )
    const nameInput = screen.getByPlaceholderText(
      'projects.addProjectDialog.namePlaceholder'
    )
    fireEvent.change(nameInput, { target: { value: 'New Project' } })
    fireEvent.click(
      screen.getByText('projects.addProjectDialog.createButton')
    )
    expect(mockOnSave).toHaveBeenCalledWith(
      'New Project',
      undefined,
      undefined,
      null
    )
  })

  it('does not call onSave with empty name', () => {
    render(
      <AddProjectDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        editingKey={null}
        onSave={mockOnSave}
      />
    )
    fireEvent.click(
      screen.getByText('projects.addProjectDialog.createButton')
    )
    expect(mockOnSave).not.toHaveBeenCalled()
  })

  it('closes on cancel', () => {
    render(
      <AddProjectDialog
        open={true}
        onOpenChange={mockOnOpenChange}
        editingKey={null}
        onSave={mockOnSave}
      />
    )
    fireEvent.click(screen.getByText('cancel'))
    expect(mockOnOpenChange).toHaveBeenCalledWith(false)
  })
})
