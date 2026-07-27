import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HuggingFaceConnectionButton,
  HuggingFaceConnectionDialog,
} from '../HuggingFaceConnectionDialog'
import { useHuggingFaceConnection } from '@/hooks/models/useHuggingFaceConnection'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) => {
      const values: Record<string, string> = {
        'hub:huggingFace.connect': 'Connect Hugging Face',
        'hub:huggingFace.connected': 'Hugging Face connected',
        'hub:huggingFace.title': 'Hugging Face Hub',
        'hub:huggingFace.description': 'Hub credential description',
        'hub:huggingFace.connectionActive': 'Hub connection active',
        'hub:huggingFace.savedOnDevice': 'Access token saved on this device',
        'hub:huggingFace.secureStorage': 'Stored securely',
        'hub:huggingFace.replaceToken': 'Replace token',
        'hub:huggingFace.disconnect': 'Disconnect',
      }
      if (key === 'hub:huggingFace.signedInAs') {
        return `Signed in as ${options?.name}`
      }
      return values[key] ?? key
    },
  }),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    children,
    open,
  }: {
    children: React.ReactNode
    open: boolean
  }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <footer>{children}</footer>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}))

describe('HuggingFaceConnectionDialog', () => {
  beforeEach(() => {
    useHuggingFaceConnection.setState(
      useHuggingFaceConnection.getInitialState(),
      true
    )
  })

  it('opens from the contextual Hub button', () => {
    render(<HuggingFaceConnectionButton />)

    fireEvent.click(
      screen.getByRole('button', { name: 'Connect Hugging Face' })
    )

    expect(useHuggingFaceConnection.getState().dialogOpen).toBe(true)
  })

  it('never renders a saved token in the connected state', () => {
    useHuggingFaceConnection.setState({
      dialogOpen: true,
      initialized: true,
      token: 'hf_do_not_render_this_secret',
      accountName: 'ax-user',
    })

    render(<HuggingFaceConnectionDialog />)

    expect(screen.getByText('Hub connection active')).toBeInTheDocument()
    expect(screen.getByText('Signed in as ax-user')).toBeInTheDocument()
    expect(
      screen.queryByText('hf_do_not_render_this_secret')
    ).not.toBeInTheDocument()
  })
})
