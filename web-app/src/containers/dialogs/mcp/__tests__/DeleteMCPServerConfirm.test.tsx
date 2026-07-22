import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DeleteMCPServerConfirm } from '../DeleteMCPServerConfirm'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    children,
    open,
  }: {
    children: React.ReactNode
    open: boolean
  }) => (open ? <div data-testid="dialog">{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    autoFocus,
    ...props
  }: React.PropsWithChildren<
    { onClick?: () => void; autoFocus?: boolean } & Record<string, unknown>
  >) => (
    <button onClick={onClick} data-autofocus={autoFocus ? 'true' : 'false'} {...props}>
      {children}
    </button>
  ),
}))

describe('DeleteMCPServerConfirm', () => {
  it('renders server name in description path', () => {
    render(
      <DeleteMCPServerConfirm
        open
        onOpenChange={vi.fn()}
        serverName="filesystem"
        onConfirm={vi.fn()}
      />
    )
    expect(
      screen.getByText('mcp-servers:deleteServer.title')
    ).toBeInTheDocument()
  })

  it('defaults autoFocus to Cancel rather than destructive delete', () => {
    render(
      <DeleteMCPServerConfirm
        open
        onOpenChange={vi.fn()}
        serverName="filesystem"
        onConfirm={vi.fn()}
      />
    )
    const cancel = screen.getByText('common:cancel')
    const del = screen.getByText('mcp-servers:deleteServer.delete')
    expect(cancel).toHaveAttribute('data-autofocus', 'true')
    expect(del).toHaveAttribute('data-autofocus', 'false')
  })

  it('calls onConfirm when delete is clicked', async () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <DeleteMCPServerConfirm
        open
        onOpenChange={onOpenChange}
        serverName="filesystem"
        onConfirm={onConfirm}
      />
    )
    fireEvent.click(screen.getByText('mcp-servers:deleteServer.delete'))
    expect(onConfirm).toHaveBeenCalledOnce()
    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('stays open when deletion is rejected by the handler', async () => {
    const onOpenChange = vi.fn()
    render(
      <DeleteMCPServerConfirm
        open
        onOpenChange={onOpenChange}
        serverName="filesystem"
        onConfirm={vi.fn().mockResolvedValue(false)}
      />
    )

    fireEvent.click(screen.getByText('mcp-servers:deleteServer.delete'))
    await waitFor(() => {
      expect(
        screen.getByText('mcp-servers:deleteServer.delete')
      ).not.toBeDisabled()
    })
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})
