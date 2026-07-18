import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { ShortcutRecorder } from '../ShortcutRecorder'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

function renderRecorder(onRemap = vi.fn().mockResolvedValue(undefined)) {
  render(
    <ShortcutRecorder value="CmdOrCtrl+Shift+Space" onRemap={onRemap} />
  )
  return onRemap
}

function enterRecording() {
  fireEvent.click(screen.getByText('settings:shortcuts.quickLaunchChange'))
  return screen.getByText('settings:shortcuts.quickLaunchRecording')
}

describe('ShortcutRecorder', () => {
  it('renders the current combo as key badges', () => {
    renderRecorder()

    expect(screen.getByText('Shift')).toBeInTheDocument()
    expect(screen.getByText('Space')).toBeInTheDocument()
    expect(
      screen.getByText('settings:shortcuts.quickLaunchChange')
    ).toBeInTheDocument()
  })

  it('enters recording mode on Change and captures a new combo', async () => {
    const onRemap = renderRecorder()
    const recordingButton = enterRecording()

    await act(async () => {
      fireEvent.keyDown(recordingButton, {
        key: 'k',
        metaKey: true,
        shiftKey: true,
      })
    })

    await waitFor(() => {
      expect(onRemap).toHaveBeenCalledWith('CmdOrCtrl+Shift+K')
    })
    // Back to idle after a successful remap
    expect(
      screen.getByText('settings:shortcuts.quickLaunchChange')
    ).toBeInTheDocument()
  })

  it('ignores pure modifier presses and keeps recording', () => {
    const onRemap = renderRecorder()
    const recordingButton = enterRecording()

    fireEvent.keyDown(recordingButton, { key: 'Shift', shiftKey: true })
    fireEvent.keyDown(recordingButton, { key: 'Meta', metaKey: true })

    expect(onRemap).not.toHaveBeenCalled()
    expect(
      screen.getByText('settings:shortcuts.quickLaunchRecording')
    ).toBeInTheDocument()
  })

  it('cancels recording on Escape without remapping', () => {
    const onRemap = renderRecorder()
    const recordingButton = enterRecording()

    fireEvent.keyDown(recordingButton, { key: 'Escape' })

    expect(onRemap).not.toHaveBeenCalled()
    expect(
      screen.getByText('settings:shortcuts.quickLaunchChange')
    ).toBeInTheDocument()
  })

  it('shows an inline error when registration fails', async () => {
    const onRemap = vi.fn().mockRejectedValue(new Error('shortcut taken'))
    renderRecorder(onRemap)
    const recordingButton = enterRecording()

    await act(async () => {
      fireEvent.keyDown(recordingButton, { key: ' ', altKey: true })
    })

    await waitFor(() => {
      expect(
        screen.getByText('settings:shortcuts.quickLaunchError')
      ).toBeInTheDocument()
    })
    expect(
      screen.getByText('settings:shortcuts.quickLaunchChange')
    ).toBeInTheDocument()
  })

  it('prevents the default browser behavior while recording', async () => {
    renderRecorder()
    const recordingButton = enterRecording()

    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })
    await act(async () => {
      recordingButton.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(true)
  })
})
