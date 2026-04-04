import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ToolApproval from './ToolApproval'

const mockOnApprove = vi.fn()
const mockOnDeny = vi.fn()
const mockSetModalOpen = vi.fn()

vi.mock('@/hooks/useToolApproval', () => ({
  useToolApproval: () => ({
    isModalOpen: true,
    modalProps: {
      toolName: 'read_file',
      toolParameters: { path: '/etc/passwd' },
      onApprove: mockOnApprove,
      onDeny: mockOnDeny,
    },
    setModalOpen: mockSetModalOpen,
  }),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('lucide-react', () => ({
  Shield: () => <span data-testid="shield-icon" />,
  Wrench: () => <span data-testid="wrench-icon" />,
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
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-description">{children}</div>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: Record<string, unknown>) => (
    <button onClick={onClick as () => void} {...props}>{children as React.ReactNode}</button>
  ),
}))

describe('ToolApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders tool name', () => {
    render(<ToolApproval />)
    expect(screen.getByText('read_file')).toBeInTheDocument()
  })

  it('renders tool parameters', () => {
    render(<ToolApproval />)
    const paramsText = screen.getByText(/\/etc\/passwd/)
    expect(paramsText).toBeInTheDocument()
  })

  it('renders all three action buttons', () => {
    render(<ToolApproval />)
    expect(screen.getByText('tools:toolApproval.deny')).toBeInTheDocument()
    expect(screen.getByText('tools:toolApproval.allowOnce')).toBeInTheDocument()
    expect(screen.getByText('tools:toolApproval.alwaysAllow')).toBeInTheDocument()
  })

  it('calls onApprove(true) when allow once is clicked', () => {
    render(<ToolApproval />)
    fireEvent.click(screen.getByText('tools:toolApproval.allowOnce'))
    expect(mockOnApprove).toHaveBeenCalledWith(true)
  })

  it('calls onApprove(false) when always allow is clicked', () => {
    render(<ToolApproval />)
    fireEvent.click(screen.getByText('tools:toolApproval.alwaysAllow'))
    expect(mockOnApprove).toHaveBeenCalledWith(false)
  })

  it('calls onDeny when deny is clicked', () => {
    render(<ToolApproval />)
    fireEvent.click(screen.getByText('tools:toolApproval.deny'))
    expect(mockOnDeny).toHaveBeenCalledOnce()
  })

  it('renders security notice', () => {
    render(<ToolApproval />)
    expect(screen.getByText('tools:toolApproval.securityNotice')).toBeInTheDocument()
    expect(screen.getByTestId('shield-icon')).toBeInTheDocument()
  })
})
