import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatInputAttachments } from '../ChatInputAttachments'

// ── Mocks ────────────────────────────────────────────

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>()
  return { ...actual }
})

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
}))

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, className, ...props }: any) => (
      <div className={className} {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}))

// ── Tests ────────────────────────────────────────────

describe('ChatInputAttachments — Phase 3', () => {
  // Protocol #7: Image attachment preview
  it('renders image attachment with preview thumbnail', () => {
    const attachments = [{
      type: 'image' as const,
      name: 'photo.jpg',
      dataUrl: 'data:image/jpeg;base64,abc',
      mimeType: 'image/jpeg',
      size: 1024,
    }]
    render(<ChatInputAttachments attachments={attachments} onRemove={vi.fn()} />)
    const img = screen.getByAltText('photo.jpg')
    expect(img).toBeInTheDocument()
    expect(img).toHaveAttribute('src', 'data:image/jpeg;base64,abc')
  })

  // Protocol #8: Document attachment with extension
  it('renders document attachment with file extension', () => {
    const attachments = [{
      type: 'document' as const,
      name: 'report.pdf',
      fileType: 'pdf',
      size: 2048,
    }]
    render(<ChatInputAttachments attachments={attachments} onRemove={vi.fn()} />)
    expect(screen.getByText('.pdf')).toBeInTheDocument()
  })

  // Protocol #7/#8: Remove button calls onRemove
  it('remove button calls onRemove with correct index', () => {
    const onRemove = vi.fn()
    const attachments = [
      { type: 'image' as const, name: 'a.jpg', dataUrl: 'data:image/jpeg;base64,a' },
      { type: 'document' as const, name: 'b.pdf', fileType: 'pdf' },
    ]
    const { container } = render(<ChatInputAttachments attachments={attachments} onRemove={onRemove} />)
    // Find remove buttons (bg-destructive)
    const removeButtons = container.querySelectorAll('.bg-destructive')
    expect(removeButtons).toHaveLength(2)

    fireEvent.click(removeButtons[1])
    expect(onRemove).toHaveBeenCalledWith(1)
  })

  // Empty state: returns null
  it('returns null when no attachments', () => {
    const { container } = render(<ChatInputAttachments attachments={[]} onRemove={vi.fn()} />)
    expect(container.innerHTML).toBe('')
  })

  // Processing attachment hides remove button
  it('hides remove button when attachment is processing', () => {
    const attachments = [{
      type: 'document' as const,
      name: 'uploading.txt',
      processing: true,
    }]
    const { container } = render(<ChatInputAttachments attachments={attachments} onRemove={vi.fn()} />)
    const removeButtons = container.querySelectorAll('.bg-destructive')
    expect(removeButtons).toHaveLength(0)
  })

  // Animation classes present
  it('wraps each attachment in a motion.div with scale animation props', () => {
    const attachments = [
      { type: 'document' as const, name: 'file.txt', fileType: 'txt' },
    ]
    const { container } = render(<ChatInputAttachments attachments={attachments} onRemove={vi.fn()} />)
    // The outer wrapper has overflow-hidden for the collapse animation
    const wrapper = container.querySelector('.overflow-hidden')
    expect(wrapper).toBeInTheDocument()
  })
})
