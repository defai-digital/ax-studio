import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import '@testing-library/jest-dom'
import { CompareComposer } from '../CompareComposer'

const renderComposer = (
  overrides: Partial<Parameters<typeof CompareComposer>[0]> = {}
) => {
  const onSubmit = vi.fn()
  render(
    <CompareComposer
      modelALabel="model-a"
      modelBLabel="model-b"
      onSubmit={onSubmit}
      {...overrides}
    />
  )
  return { onSubmit }
}

describe('CompareComposer', () => {
  it('shows both model labels', () => {
    renderComposer()

    expect(screen.getByText('model-a')).toBeInTheDocument()
    expect(screen.getByText('model-b')).toBeInTheDocument()
  })

  it('submits the trimmed text on send-button click and clears the input', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderComposer()

    const textarea = screen.getByLabelText('Compare models composer')
    await user.type(textarea, '  hello both  ')
    await user.click(screen.getByRole('button', { name: 'Send to both models' }))

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('hello both')
    expect(textarea).toHaveValue('')
  })

  it('submits on Enter but not on Shift+Enter', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderComposer()

    const textarea = screen.getByLabelText('Compare models composer')
    await user.type(textarea, 'line one{Shift>}{Enter}{/Shift}line two')
    expect(onSubmit).not.toHaveBeenCalled()

    await user.type(textarea, '{Enter}')
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledWith('line one\nline two')
  })

  it('keeps the send button disabled for empty or whitespace-only input', async () => {
    const user = userEvent.setup()
    renderComposer()

    const sendButton = screen.getByRole('button', {
      name: 'Send to both models',
    })
    expect(sendButton).toBeDisabled()

    const textarea = screen.getByLabelText('Compare models composer')
    await user.type(textarea, '   ')
    expect(sendButton).toBeDisabled()
  })

  it('does not submit while disabled (a pane is generating)', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderComposer({ disabled: true })

    const textarea = screen.getByLabelText('Compare models composer')
    expect(textarea).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Send to both models' })
    ).toBeDisabled()

    // Even a synthetic Enter must not dispatch.
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
