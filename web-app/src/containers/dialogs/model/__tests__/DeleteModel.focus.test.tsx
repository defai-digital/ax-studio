import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DialogDeleteModel } from '../DeleteModel'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { modelId?: string }) =>
      opts?.modelId ? `${key}:${opts.modelId}` : key,
  }),
}))

vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: () => ({
    updateProvider: vi.fn(),
  }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    models(): { stopModel: () => Promise<void> } {
      return { stopModel: vi.fn().mockResolvedValue(undefined) }
    },
  }),
}))

vi.mock('@/hooks/settings/useAppState', () => ({
  useAppState: (
    selector: (s: { setActiveModels: () => void }) => unknown
  ) => selector({ setActiveModels: vi.fn() }),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog">{children}</div>
  ),
  DialogTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
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
  DialogClose: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
    <button
      onClick={onClick}
      data-autofocus={autoFocus ? 'true' : 'false'}
      {...props}
    >
      {children}
    </button>
  ),
}))

describe('DialogDeleteModel focus defaults', () => {
  const provider = {
    provider: 'openai',
    models: [{ id: 'gpt-4', name: 'GPT-4' }],
  } as ModelProvider

  it('labels the icon-only delete trigger', () => {
    render(<DialogDeleteModel provider={provider} modelId="gpt-4" />)
    expect(
      screen.getByRole('button', {
        name: 'providers:deleteModel.title:gpt-4',
      })
    ).toBeInTheDocument()
  })

  it('defaults autoFocus to cancel, not destructive delete', () => {
    render(<DialogDeleteModel provider={provider} modelId="gpt-4" />)
    const cancel = screen.getByText('providers:deleteModel.cancel')
    const del = screen.getByText('providers:deleteModel.delete')
    expect(cancel).toHaveAttribute('data-autofocus', 'true')
    expect(del).toHaveAttribute('data-autofocus', 'false')
  })
})
