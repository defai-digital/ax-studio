import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { TextareaControl } from './TextareaControl'

vi.mock('@/hooks/useGeneralSetting', () => ({
  useGeneralSetting: () => ({
    spellCheckChatInput: true,
  }),
}))

describe('TextareaControl', () => {
  it('renders a textarea with the provided value', () => {
    render(<TextareaControl value="hello world" onChange={vi.fn()} />)

    expect(screen.getByDisplayValue('hello world')).toBeInTheDocument()
  })

  it('calls onChange when text is typed', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<TextareaControl value="" onChange={onChange} />)

    const textarea = screen.getByRole('textbox')
    await user.type(textarea, 'a')
    expect(onChange).toHaveBeenCalledWith('a')
  })

  it('applies placeholder', () => {
    render(
      <TextareaControl
        value=""
        onChange={vi.fn()}
        placeholder="Type here..."
      />
    )

    expect(screen.getByPlaceholderText('Type here...')).toBeInTheDocument()
  })

  it('sets spellCheck based on general settings', () => {
    render(<TextareaControl value="" onChange={vi.fn()} />)

    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveAttribute('spellcheck', 'true')
  })

  it('renders with default 4 rows', () => {
    render(<TextareaControl value="" onChange={vi.fn()} />)

    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveAttribute('rows', '4')
  })

  it('renders with custom rows', () => {
    render(<TextareaControl value="" onChange={vi.fn()} rows={8} />)

    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveAttribute('rows', '8')
  })
})
