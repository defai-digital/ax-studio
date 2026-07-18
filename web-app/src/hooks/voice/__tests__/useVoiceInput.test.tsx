import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>()
  return {
    listeners,
    voice: {
      isAvailable: vi.fn().mockReturnValue(true),
      startRecording: vi.fn().mockResolvedValue(undefined),
      stopRecording: vi.fn().mockResolvedValue('there'),
      cancelRecording: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockResolvedValue({
        state: 'idle',
        modelDownloaded: true,
        audioLevel: 0,
      }),
      downloadModel: vi.fn().mockResolvedValue(undefined),
      cancelModelDownload: vi.fn().mockResolvedValue(undefined),
      deleteModel: vi.fn().mockResolvedValue(undefined),
    },
    navigate: vi.fn(),
    toast: Object.assign(vi.fn(), { error: vi.fn() }),
  }
})

vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({
    voice: () => mocks.voice,
    events: () => ({
      listen: vi.fn(async (event: string, handler: never) => {
        mocks.listeners.set(event, handler)
        return () => {
          mocks.listeners.delete(event)
        }
      }),
      emit: vi.fn().mockResolvedValue(undefined),
    }),
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
}))

vi.mock('sonner', () => ({ toast: mocks.toast }))

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { useVoiceInput } from '../useVoiceInput'
import { useVoiceSettings } from '@/hooks/settings/useVoiceSettings'

/** Flush microtasks + jsdom requestAnimationFrame callbacks. */
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })

const emitVoiceEvent = (event: string, payload: unknown) => {
  act(() => {
    mocks.listeners.get(event)?.({ payload })
  })
}

describe('useVoiceInput', () => {
  let textarea: HTMLTextAreaElement
  let textareaRef: { current: HTMLTextAreaElement | null }
  let setPrompt: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listeners.clear()
    mocks.voice.isAvailable.mockReturnValue(true)
    mocks.voice.getStatus.mockResolvedValue({
      state: 'idle',
      modelDownloaded: true,
      audioLevel: 0,
    })
    mocks.voice.stopRecording.mockResolvedValue('there')
    useVoiceSettings.setState({
      voiceInputEnabled: true,
      voiceModel: 'base.en',
    })
    textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    textareaRef = { current: textarea }
    setPrompt = vi.fn()
  })

  afterEach(() => {
    textarea.remove()
  })

  const renderUseVoiceInput = (prompt = 'hello world') =>
    renderHook(() => useVoiceInput({ textareaRef, prompt, setPrompt }))

  it('is visible when the service is available and the setting is enabled', () => {
    const { result } = renderUseVoiceInput()
    expect(result.current.visible).toBe(true)
    expect(result.current.state).toBe('idle')
  })

  it('is hidden when the setting is disabled or the platform lacks voice', () => {
    useVoiceSettings.setState({ voiceInputEnabled: false })
    const disabled = renderUseVoiceInput()
    expect(disabled.result.current.visible).toBe(false)
    disabled.unmount()

    mocks.voice.isAvailable.mockReturnValue(false)
    useVoiceSettings.setState({ voiceInputEnabled: true })
    const unavailable = renderUseVoiceInput()
    expect(unavailable.result.current.visible).toBe(false)
  })

  it('starts recording on toggle when the model is downloaded', async () => {
    const { result } = renderUseVoiceInput()

    await act(async () => {
      result.current.toggle()
    })

    expect(mocks.voice.getStatus).toHaveBeenCalledWith('base.en')
    expect(mocks.voice.startRecording).toHaveBeenCalledWith('base.en')
    expect(result.current.state).toBe('recording')
  })

  it('routes to Voice settings when the model is not downloaded', async () => {
    mocks.voice.getStatus.mockResolvedValue({
      state: 'idle',
      modelDownloaded: false,
      audioLevel: 0,
    })
    const { result } = renderUseVoiceInput()

    await act(async () => {
      result.current.toggle()
    })

    expect(mocks.voice.startRecording).not.toHaveBeenCalled()
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/settings/voice' })
    expect(mocks.toast).toHaveBeenCalledWith('common:voiceModelRequired')
    expect(result.current.state).toBe('idle')
  })

  it('routes to Voice settings when start fails with model-not-downloaded', async () => {
    mocks.voice.startRecording.mockRejectedValueOnce({
      kind: 'model-not-downloaded',
      message: "voice model 'base.en' is not downloaded",
    })
    const { result } = renderUseVoiceInput()

    await act(async () => {
      result.current.toggle()
    })

    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/settings/voice' })
    expect(result.current.state).toBe('idle')
  })

  it('surfaces mic permission errors as a toast, not a navigation', async () => {
    mocks.voice.startRecording.mockRejectedValueOnce({
      kind: 'mic-permission-denied',
      message: 'denied',
    })
    const { result } = renderUseVoiceInput()

    await act(async () => {
      result.current.toggle()
    })

    expect(mocks.toast.error).toHaveBeenCalledWith(
      'common:voiceMicPermissionDenied'
    )
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(result.current.state).toBe('idle')
  })

  it('stops on second toggle and inserts the transcript at the cursor', async () => {
    textarea.value = 'hello world'
    textarea.setSelectionRange(5, 5)
    const { result } = renderUseVoiceInput('hello world')

    await act(async () => {
      result.current.toggle()
    })
    await act(async () => {
      result.current.toggle()
    })

    expect(mocks.voice.stopRecording).toHaveBeenCalled()
    // Smart spacing: 'hello' + ' there' + ' world'
    expect(setPrompt).toHaveBeenCalledWith('hello there world')
    expect(result.current.state).toBe('idle')

    // Composer keeps focus with the caret right after the inserted text.
    await flush()
    expect(document.activeElement).toBe(textarea)
    expect(textarea.selectionStart).toBe('hello there'.length)
  })

  it('replaces the current selection with the transcript', async () => {
    textarea.value = 'hello world'
    textarea.setSelectionRange(0, 5)
    const { result } = renderUseVoiceInput('hello world')

    await act(async () => {
      result.current.toggle()
    })
    await act(async () => {
      result.current.toggle()
    })

    expect(setPrompt).toHaveBeenCalledWith('there world')
  })

  it('appends at the end when there is no textarea', async () => {
    textareaRef.current = null
    const { result } = renderUseVoiceInput('hello')

    await act(async () => {
      result.current.toggle()
    })
    await act(async () => {
      result.current.toggle()
    })

    expect(setPrompt).toHaveBeenCalledWith('hello there')
  })

  it('does not glue the transcript onto trailing whitespace', async () => {
    textarea.value = 'hello '
    textarea.setSelectionRange(6, 6)
    const { result } = renderUseVoiceInput('hello ')

    await act(async () => {
      result.current.toggle()
    })
    await act(async () => {
      result.current.toggle()
    })

    expect(setPrompt).toHaveBeenCalledWith('hello there')
  })

  it('ignores empty transcripts', async () => {
    mocks.voice.stopRecording.mockResolvedValue('   ')
    textarea.value = 'hello'
    const { result } = renderUseVoiceInput('hello')

    await act(async () => {
      result.current.toggle()
    })
    await act(async () => {
      result.current.toggle()
    })

    expect(setPrompt).not.toHaveBeenCalled()
    expect(result.current.state).toBe('idle')
  })

  it('cancels recording on Escape', async () => {
    const { result } = renderUseVoiceInput()

    await act(async () => {
      result.current.toggle()
    })
    expect(result.current.state).toBe('recording')

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
      )
    })

    expect(mocks.voice.cancelRecording).toHaveBeenCalled()
    expect(result.current.state).toBe('idle')
  })

  it('cancel() discards the recording without transcribing', async () => {
    const { result } = renderUseVoiceInput()

    await act(async () => {
      result.current.toggle()
    })
    act(() => {
      result.current.cancel()
    })

    expect(mocks.voice.cancelRecording).toHaveBeenCalled()
    expect(mocks.voice.stopRecording).not.toHaveBeenCalled()
    expect(result.current.state).toBe('idle')
  })

  it('inserts the auto-stop transcript pushed by the Rust worker', async () => {
    textarea.value = 'hello'
    textarea.setSelectionRange(5, 5)
    const { result } = renderUseVoiceInput('hello')

    await act(async () => {
      result.current.toggle()
    })
    await flush() // let the event subscriptions resolve

    emitVoiceEvent('voice-transcript', { text: 'auto stopped' })

    expect(setPrompt).toHaveBeenCalledWith('hello auto stopped')
    expect(result.current.state).toBe('idle')
    // No manual stop → no command reply involved.
    expect(mocks.voice.stopRecording).not.toHaveBeenCalled()
  })

  it('tracks mic level and backend state events', async () => {
    const { result } = renderUseVoiceInput()
    await flush()

    emitVoiceEvent('voice-level', { level: 0.42 })
    expect(result.current.level).toBe(0.42)

    emitVoiceEvent('voice-state', { state: 'transcribing' })
    expect(result.current.state).toBe('transcribing')
    expect(result.current.level).toBe(0)

    emitVoiceEvent('voice-state', { state: 'idle' })
    expect(result.current.state).toBe('idle')
  })

  it('swallows a not-recording stop rejection (auto-stop won the race)', async () => {
    mocks.voice.stopRecording.mockRejectedValueOnce({
      kind: 'not-recording',
      message: 'no recording in progress',
    })
    const { result } = renderUseVoiceInput()

    await act(async () => {
      result.current.toggle()
    })
    await act(async () => {
      result.current.toggle()
    })

    expect(mocks.toast.error).not.toHaveBeenCalled()
    expect(result.current.state).toBe('idle')
  })

  it('counts elapsed seconds while recording', async () => {
    vi.useFakeTimers()
    try {
      const { result } = renderUseVoiceInput()

      await act(async () => {
        result.current.toggle()
      })
      expect(result.current.state).toBe('recording')

      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(result.current.elapsedSeconds).toBe(3)
    } finally {
      vi.useRealTimers()
    }
  })
})
