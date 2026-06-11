import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CopyButton } from '../CopyButton'

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: React.PropsWithChildren<{ onClick?: () => void }>) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('lucide-react', () => ({
  Copy: () => <span data-testid="icon-copy" />,
  CheckCheck: () => <span data-testid="icon-copy-check" />,
}))

describe('CopyButton', () => {
  const writeTextMock = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the copy icon initially', () => {
    render(<CopyButton text="hello" />)
    expect(screen.getByTestId('icon-copy')).toBeInTheDocument()
    expect(screen.queryByTestId('icon-copy-check')).not.toBeInTheDocument()
  })

  it('copies text to clipboard and shows check icon', async () => {
    render(<CopyButton text="hello world" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
      await Promise.resolve()
    })
    expect(writeTextMock).toHaveBeenCalledWith('hello world')
    expect(screen.getByTestId('icon-copy-check')).toBeInTheDocument()
    expect(screen.queryByTestId('icon-copy')).not.toBeInTheDocument()
  })

  it('reverts to copy icon after 2 seconds', async () => {
    render(<CopyButton text="test" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
      await Promise.resolve()
    })
    expect(screen.getByTestId('icon-copy-check')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    expect(screen.getByTestId('icon-copy')).toBeInTheDocument()
    expect(screen.queryByTestId('icon-copy-check')).not.toBeInTheDocument()
  })

  it('copies different text values correctly', async () => {
    const { rerender } = render(<CopyButton text="first" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
      await Promise.resolve()
    })
    expect(writeTextMock).toHaveBeenCalledWith('first')
    expect(screen.getByTestId('icon-copy-check')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(2000)
    })

    rerender(<CopyButton text="second" />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
      await Promise.resolve()
    })
    expect(writeTextMock).toHaveBeenCalledWith('second')
  })
})
