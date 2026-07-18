import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { VoiceMicButton } from '../VoiceMicButton'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

const createProps = (
  overrides: Partial<Parameters<typeof VoiceMicButton>[0]> = {}
) => ({
  state: 'idle' as const,
  level: 0,
  elapsedSeconds: 0,
  onToggle: vi.fn(),
  onCancel: vi.fn(),
  ...overrides,
})

describe('VoiceMicButton', () => {
  it('renders a plain mic button when idle', () => {
    const props = createProps()
    render(<VoiceMicButton {...props} />)

    const button = screen.getByTestId('voice-mic-button')
    expect(button).toHaveAttribute('data-state', 'idle')
    expect(button).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(button)
    expect(props.onToggle).toHaveBeenCalledTimes(1)
    expect(props.onCancel).not.toHaveBeenCalled()
  })

  it('renders recording state with elapsed time and level bar', () => {
    const props = createProps({
      state: 'recording',
      level: 0.5,
      elapsedSeconds: 7,
    })
    render(<VoiceMicButton {...props} />)

    const button = screen.getByTestId('voice-mic-button')
    expect(button).toHaveAttribute('data-state', 'recording')
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button.className).toContain('animate-pulse')

    expect(screen.getByTestId('voice-elapsed')).toHaveTextContent('0:07')

    const levelBar = screen.getByTestId('voice-level-bar')
    expect(levelBar.firstChild).toHaveStyle({ width: '50%' })

    // Clicking the mic again stops & transcribes (toggle).
    fireEvent.click(button)
    expect(props.onToggle).toHaveBeenCalledTimes(1)
  })

  it('formats elapsed time as m:ss', () => {
    render(
      <VoiceMicButton {...createProps({ state: 'recording', elapsedSeconds: 65 })} />
    )
    expect(screen.getByTestId('voice-elapsed')).toHaveTextContent('1:05')

    render(
      <VoiceMicButton {...createProps({ state: 'recording', elapsedSeconds: 600 })} />
    )
    expect(screen.getAllByTestId('voice-elapsed')[1]).toHaveTextContent('10:00')
  })

  it('clamps the level bar to 100%', () => {
    render(<VoiceMicButton {...createProps({ state: 'recording', level: 4 })} />)
    expect(screen.getByTestId('voice-level-bar').firstChild).toHaveStyle({
      width: '100%',
    })
  })

  it('cancel button fires onCancel without toggling', () => {
    const props = createProps({ state: 'recording' })
    render(<VoiceMicButton {...props} />)

    fireEvent.click(screen.getByTestId('voice-cancel-button'))
    expect(props.onCancel).toHaveBeenCalledTimes(1)
    expect(props.onToggle).not.toHaveBeenCalled()
  })

  it('renders a spinner while transcribing and no mic button', () => {
    render(<VoiceMicButton {...createProps({ state: 'transcribing' })} />)

    expect(screen.getByTestId('voice-transcribing')).toBeInTheDocument()
    expect(screen.queryByTestId('voice-mic-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('voice-cancel-button')).not.toBeInTheDocument()
  })
})
