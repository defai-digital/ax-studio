import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WindowControls } from './WindowControls'

// ── Mocks ────────────────────────────────────────────

const mockMinimize = vi.fn()
const mockToggleMaximize = vi.fn()
const mockClose = vi.fn()

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({
    minimize: mockMinimize,
    toggleMaximize: mockToggleMaximize,
    close: mockClose,
  }),
}))

vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>()
  return { ...actual }
})

// ── Tests ────────────────────────────────────────────

describe('WindowControls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders three control buttons', () => {
    render(<WindowControls />)
    expect(screen.getByLabelText('Minimize')).toBeInTheDocument()
    expect(screen.getByLabelText('Maximize')).toBeInTheDocument()
    expect(screen.getByLabelText('Close')).toBeInTheDocument()
  })

  it('calls minimize on Minimize button click', () => {
    render(<WindowControls />)
    fireEvent.click(screen.getByLabelText('Minimize'))
    expect(mockMinimize).toHaveBeenCalledTimes(1)
  })

  it('calls toggleMaximize on Maximize button click', () => {
    render(<WindowControls />)
    fireEvent.click(screen.getByLabelText('Maximize'))
    expect(mockToggleMaximize).toHaveBeenCalledTimes(1)
  })

  it('calls close on Close button click', () => {
    render(<WindowControls />)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(mockClose).toHaveBeenCalledTimes(1)
  })

  it('renders all buttons inside a container div', () => {
    const { container } = render(<WindowControls />)
    const buttons = container.querySelectorAll('button')
    expect(buttons.length).toBe(3)
  })
})
