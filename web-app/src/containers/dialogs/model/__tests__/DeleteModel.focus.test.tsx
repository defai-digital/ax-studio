import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DialogDeleteModel } from '../DeleteModel'

const mocks = vi.hoisted(() => ({
  deleteModel: vi.fn(),
  deleteModelCache: vi.fn(),
  getProviders: vi.fn(),
  removeFavorite: vi.fn(),
  setProviders: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { modelId?: string }) =>
      opts?.modelId ? `${key}:${opts.modelId}` : key,
  }),
}))

vi.mock('@/hooks/models/useModelProvider', () => ({
  useModelProvider: () => ({
    deleteModel: mocks.deleteModelCache,
    setProviders: mocks.setProviders,
  }),
}))

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    models: () => ({ deleteModel: mocks.deleteModel }),
    providers: () => ({ getProviders: mocks.getProviders }),
  }),
}))

vi.mock('@/hooks/models/useFavoriteModel', () => ({
  useFavoriteModel: () => ({ removeFavorite: mocks.removeFavorite }),
}))

vi.mock('sonner', () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
  },
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

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.deleteModel.mockResolvedValue(undefined)
    mocks.getProviders.mockResolvedValue([provider])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

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

  it('keeps local model state intact when backend deletion fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.deleteModel.mockRejectedValueOnce(new Error('file is locked'))
    render(<DialogDeleteModel provider={provider} modelId="gpt-4" />)

    fireEvent.click(screen.getByText('providers:deleteModel.delete'))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        'Failed to delete model. Please try again.'
      )
    })
    expect(mocks.removeFavorite).not.toHaveBeenCalled()
    expect(mocks.deleteModelCache).not.toHaveBeenCalled()
  })

  it('removes local model state only after backend deletion succeeds', async () => {
    let resolveDelete!: () => void
    mocks.deleteModel.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve
        })
    )
    render(<DialogDeleteModel provider={provider} modelId="gpt-4" />)

    fireEvent.click(screen.getByText('providers:deleteModel.delete'))
    expect(mocks.removeFavorite).not.toHaveBeenCalled()
    expect(mocks.deleteModelCache).not.toHaveBeenCalled()

    resolveDelete()

    await waitFor(() => {
      expect(mocks.removeFavorite).toHaveBeenCalledWith('gpt-4')
      expect(mocks.deleteModelCache).toHaveBeenCalledWith('gpt-4')
    })
  })
})
