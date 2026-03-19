import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AddEditMCPServer from '../AddEditMCPServer'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}` : key,
  }),
}))

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@tabler/icons-react', () => ({
  IconPlus: () => <span data-testid="icon-plus" />,
  IconTrash: () => <span data-testid="icon-trash" />,
  IconGripVertical: () => <span />,
  IconCodeDots: () => <span data-testid="icon-code" />,
}))

vi.mock('@uiw/react-textarea-code-editor', () => ({
  default: ({ value, onChange, placeholder }: Record<string, unknown>) => (
    <textarea
      data-testid="code-editor"
      value={value as string}
      onChange={onChange as React.ChangeEventHandler<HTMLTextAreaElement>}
      placeholder={placeholder as string}
    />
  ),
}))

vi.mock('@uiw/react-textarea-code-editor/dist.css', () => ({}))

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  closestCenter: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn().mockReturnValue([]),
  PointerSensor: vi.fn(),
  KeyboardSensor: vi.fn(),
}))

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: 'vertical',
  arrayMove: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => '' } },
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

vi.mock('@/components/ui/radio-group', () => ({
  RadioGroup: ({ children, onValueChange, value }: Record<string, unknown>) => (
    <div data-testid="radio-group" data-value={value as string}>
      {children as React.ReactNode}
    </div>
  ),
  RadioGroupItem: ({ value }: { value: string }) => (
    <input type="radio" data-testid={`radio-${value}`} value={value} readOnly />
  ),
}))

describe('AddEditMCPServer', () => {
  const mockOnSave = vi.fn()
  const mockOnOpenChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders add mode title when editingKey is null', () => {
    render(
      <AddEditMCPServer
        open={true}
        onOpenChange={mockOnOpenChange}
        editingKey={null}
        onSave={mockOnSave}
      />
    )
    expect(screen.getByTestId('dialog-title').textContent).toContain(
      'mcp-servers:addServer'
    )
  })

  it('renders edit mode title when editingKey is set', () => {
    render(
      <AddEditMCPServer
        open={true}
        onOpenChange={mockOnOpenChange}
        editingKey="my-server"
        initialData={{ command: 'node', args: ['server.js'], env: {} }}
        onSave={mockOnSave}
      />
    )
    expect(screen.getByTestId('dialog-title').textContent).toContain(
      'mcp-servers:editServer'
    )
  })

  it('does not render when closed', () => {
    render(
      <AddEditMCPServer
        open={false}
        onOpenChange={mockOnOpenChange}
        editingKey={null}
        onSave={mockOnSave}
      />
    )
    expect(screen.queryByTestId('dialog')).toBeNull()
  })

  it('disables save button when server name is empty in form mode', () => {
    render(
      <AddEditMCPServer
        open={true}
        onOpenChange={mockOnOpenChange}
        editingKey={null}
        onSave={mockOnSave}
      />
    )
    const saveButton = screen.getByText('mcp-servers:save')
    expect(saveButton).toBeDisabled()
  })

  it('enables save button when server name is provided', () => {
    render(
      <AddEditMCPServer
        open={true}
        onOpenChange={mockOnOpenChange}
        editingKey={null}
        onSave={mockOnSave}
      />
    )
    const nameInput = screen.getByPlaceholderText('mcp-servers:enterServerName')
    fireEvent.change(nameInput, { target: { value: 'my-server' } })
    const saveButton = screen.getByText('mcp-servers:save')
    expect(saveButton).not.toBeDisabled()
  })

  it('calls onSave with config when form is submitted', () => {
    render(
      <AddEditMCPServer
        open={true}
        onOpenChange={mockOnOpenChange}
        editingKey={null}
        onSave={mockOnSave}
      />
    )
    const nameInput = screen.getByPlaceholderText('mcp-servers:enterServerName')
    fireEvent.change(nameInput, { target: { value: 'test-server' } })

    const commandInput = screen.getByPlaceholderText('mcp-servers:enterCommand')
    fireEvent.change(commandInput, { target: { value: 'npx' } })

    fireEvent.click(screen.getByText('mcp-servers:save'))
    expect(mockOnSave).toHaveBeenCalledWith('test-server', expect.objectContaining({
      command: 'npx',
      type: 'stdio',
    }))
  })

  it('closes dialog on cancel', () => {
    render(
      <AddEditMCPServer
        open={true}
        onOpenChange={mockOnOpenChange}
        editingKey={null}
        onSave={mockOnSave}
      />
    )
    fireEvent.click(screen.getByText('common:cancel'))
    expect(mockOnOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders transport type radio buttons', () => {
    render(
      <AddEditMCPServer
        open={true}
        onOpenChange={mockOnOpenChange}
        editingKey={null}
        onSave={mockOnSave}
      />
    )
    expect(screen.getByTestId('radio-stdio')).toBeInTheDocument()
    expect(screen.getByTestId('radio-http')).toBeInTheDocument()
    expect(screen.getByTestId('radio-sse')).toBeInTheDocument()
  })
})
