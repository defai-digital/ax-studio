import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EditJsonMCPserver } from '../EditJsonMCPserver'

const translate = (key: string) => key

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: translate,
  }),
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

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: Record<string, unknown>) => (
    <button onClick={onClick as () => void} {...props}>
      {children as React.ReactNode}
    </button>
  ),
}))

describe('EditJsonMCPserver', () => {
  const mockOnSave = vi.fn()
  const mockOnOpenChange = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('saves valid JSON object content', async () => {
    render(
      <EditJsonMCPserver
        open={true}
        onOpenChange={mockOnOpenChange}
        serverName={null}
        initialData={{ mcpServers: {} }}
        onSave={mockOnSave}
      />
    )

    fireEvent.change(screen.getByTestId('code-editor'), {
      target: {
        value:
          '{"mcpServers":{"server":{"command":"node","args":[],"env":{}}}}',
      },
    })
    fireEvent.click(screen.getByText('mcp-servers:editJson.save'))

    expect(mockOnSave).toHaveBeenCalledWith({
      mcpServers: {
        server: {
          command: 'node',
          args: [],
          env: {},
        },
      },
    })
    await waitFor(() => {
      expect(mockOnOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('rejects malformed JSON', () => {
    render(
      <EditJsonMCPserver
        open={true}
        onOpenChange={mockOnOpenChange}
        serverName={null}
        initialData={{ mcpServers: {} }}
        onSave={mockOnSave}
      />
    )

    fireEvent.change(screen.getByTestId('code-editor'), {
      target: { value: '{"mcpServers":' },
    })
    fireEvent.click(screen.getByText('mcp-servers:editJson.save'))

    expect(mockOnSave).not.toHaveBeenCalled()
    expect(mockOnOpenChange).not.toHaveBeenCalled()
    expect(
      screen.getByText('mcp-servers:editJson.errorFormat')
    ).toBeInTheDocument()
  })

  it('rejects top-level arrays instead of saving them as config objects', () => {
    render(
      <EditJsonMCPserver
        open={true}
        onOpenChange={mockOnOpenChange}
        serverName={null}
        initialData={{ mcpServers: {} }}
        onSave={mockOnSave}
      />
    )

    fireEvent.change(screen.getByTestId('code-editor'), {
      target: { value: '[]' },
    })
    fireEvent.click(screen.getByText('mcp-servers:editJson.save'))

    expect(mockOnSave).not.toHaveBeenCalled()
    expect(mockOnOpenChange).not.toHaveBeenCalled()
    expect(
      screen.getByText('mcp-servers:editJson.errorFormat')
    ).toBeInTheDocument()
  })

  it('keeps the editor open when the async save is rejected', async () => {
    mockOnSave.mockResolvedValueOnce(false)
    render(
      <EditJsonMCPserver
        open={true}
        onOpenChange={mockOnOpenChange}
        serverName={null}
        initialData={{ mcpServers: {} }}
        onSave={mockOnSave}
      />
    )

    fireEvent.click(screen.getByText('mcp-servers:editJson.save'))
    await waitFor(() => {
      expect(screen.getByText('mcp-servers:editJson.save')).not.toBeDisabled()
    })
    expect(mockOnOpenChange).not.toHaveBeenCalled()
  })
})
