import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MessageRatingActions } from '@/components/chat/MessageRatingActions'

function setup(
  overrides: Partial<Parameters<typeof MessageRatingActions>[0]> = {}
) {
  const props = {
    rating: undefined,
    feedback: undefined,
    onRateUp: vi.fn(),
    onSubmitDownvote: vi.fn(),
    onClearRating: vi.fn(),
    ...overrides,
  }
  render(<MessageRatingActions {...props} />)
  return props
}

describe('MessageRatingActions', () => {
  it('calls onRateUp when thumbs-up is clicked', () => {
    const props = setup()
    fireEvent.click(screen.getByLabelText('Good response'))
    expect(props.onRateUp).toHaveBeenCalledTimes(1)
  })

  it('captures reasons + comment on downvote submit', () => {
    const props = setup()
    fireEvent.click(screen.getByLabelText('Poor response'))

    // popover opens with reason chips
    fireEvent.click(screen.getByText('Incorrect'))
    fireEvent.click(screen.getByText('Too long'))
    fireEvent.change(screen.getByPlaceholderText('Add details (optional)'), {
      target: { value: 'made up an API' },
    })
    fireEvent.click(screen.getByText('Submit'))

    expect(props.onSubmitDownvote).toHaveBeenCalledWith({
      reasons: ['Incorrect', 'Too long'],
      comment: 'made up an API',
    })
  })

  it('submitting with nothing selected records an empty downvote', () => {
    const props = setup()
    fireEvent.click(screen.getByLabelText('Poor response'))
    fireEvent.click(screen.getByText('Submit'))
    expect(props.onSubmitDownvote).toHaveBeenCalledWith({
      reasons: [],
      comment: '',
    })
  })

  it('links to the dedicated AI-content report form', () => {
    setup()
    fireEvent.click(screen.getByLabelText('Poor response'))

    expect(
      screen.getByRole('link', { name: 'Report inappropriate AI content' })
    ).toHaveAttribute(
      'href',
      'https://github.com/defai-digital/ax-studio/issues/new?template=ai-content-report.yml'
    )
  })

  it('pre-fills the form from existing feedback and can clear it', () => {
    const props = setup({
      rating: 'down',
      feedback: { reasons: ['Refused'], comment: 'nope' },
    })
    fireEvent.click(screen.getByLabelText('Poor response'))

    expect(screen.getByPlaceholderText('Add details (optional)')).toHaveValue(
      'nope'
    )
    // Remove action only present when already downvoted
    fireEvent.click(screen.getByText('Remove'))
    expect(props.onClearRating).toHaveBeenCalledTimes(1)
  })
})
