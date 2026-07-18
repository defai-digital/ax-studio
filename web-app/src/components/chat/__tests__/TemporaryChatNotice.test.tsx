import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TemporaryChatNotice } from '../TemporaryChatNotice'

describe('TemporaryChatNotice', () => {
  it('renders the not-saved status text with a status role', () => {
    render(<TemporaryChatNotice />)
    const notice = screen.getByRole('status')
    expect(notice).toHaveTextContent(
      "Temporary chat — this conversation won't be saved"
    )
  })

  it('uses low-key dashed, muted styling', () => {
    render(<TemporaryChatNotice />)
    const notice = screen.getByTestId('temporary-chat-notice')
    expect(notice.className).toContain('border-dashed')
    expect(notice.className).toContain('text-muted-foreground')
  })
})
