/**
 * useVoiceInput — state machine for on-device dictation
 * (idle → recording → transcribing → idle), backed by the Rust voice
 * commands via the service hub (tech spec DESKTOP-NATIVE §4.C).
 *
 * Handles: mic level + state event subscriptions, the silence auto-stop
 * transcript event, Esc-to-cancel, elapsed time, and transcript insertion
 * at the textarea cursor (append fallback), keeping composer focus.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { route } from '@/constants/routes'
import { useServiceHub } from '@/hooks/useServiceHub'
import { useVoiceSettings } from '@/hooks/settings/useVoiceSettings'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  isVoiceError,
  VOICE_LEVEL_EVENT,
  VOICE_STATE_EVENT,
  VOICE_TRANSCRIPT_EVENT,
  type VoiceRecordingState,
} from '@/services/voice/types'

type Options = {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  prompt: string
  setPrompt: (value: string) => void
}

export type VoiceInputController = {
  /** Whether the mic button should render (desktop shell + enabled). */
  visible: boolean
  state: VoiceRecordingState
  /** Mic RMS level in 0..1 while recording. */
  level: number
  elapsedSeconds: number
  toggle: () => void
  cancel: () => void
}

export function useVoiceInput({
  textareaRef,
  prompt,
  setPrompt,
}: Options): VoiceInputController {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const serviceHub = useServiceHub()
  const enabled = useVoiceSettings((state) => state.voiceInputEnabled)
  const model = useVoiceSettings((state) => state.voiceModel)

  const [state, setState] = useState<VoiceRecordingState>('idle')
  const [level, setLevel] = useState(0)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  const visible = serviceHub.voice().isAvailable() && enabled

  // Latest-value refs so event/timeout handlers never capture stale state.
  const promptRef = useRef(prompt)
  promptRef.current = prompt
  const modelRef = useRef(model)
  modelRef.current = model

  /**
   * Insert the transcript at the textarea cursor; falls back to appending
   * when no cursor info is available. Keeps the composer focused.
   */
  const insertTranscript = useCallback(
    (raw: string) => {
      const text = raw.trim()
      if (!text) return
      const el = textareaRef.current
      const current = el?.value ?? promptRef.current
      let start = el ? (el.selectionStart ?? current.length) : current.length
      let end = el ? (el.selectionEnd ?? current.length) : current.length
      if (start > current.length) start = current.length
      if (end > current.length) end = current.length
      // Smart spacing so dictated text never glues onto the previous word.
      const leading = start > 0 && !/\s/.test(current[start - 1]) ? ' ' : ''
      const insertion = leading + text
      const next = current.slice(0, start) + insertion + current.slice(end)
      setPrompt(next)
      const caret = start + insertion.length
      // Wait for the controlled value to paint, then restore focus + caret.
      requestAnimationFrame(() => {
        const target = textareaRef.current
        if (target) {
          target.focus()
          target.setSelectionRange(caret, caret)
        }
      })
    },
    [textareaRef, setPrompt]
  )

  const start = useCallback(async () => {
    const voice = serviceHub.voice()
    const currentModel = modelRef.current
    try {
      const status = await voice.getStatus(currentModel)
      if (!status.modelDownloaded) {
        toast(t('common:voiceModelRequired'))
        navigate({ to: route.settings.voice })
        return
      }
      await voice.startRecording(currentModel)
      setElapsedSeconds(0)
      setState('recording')
    } catch (error) {
      if (isVoiceError(error)) {
        if (error.kind === 'model-not-downloaded') {
          toast(t('common:voiceModelRequired'))
          navigate({ to: route.settings.voice })
          return
        }
        if (error.kind === 'mic-permission-denied') {
          toast.error(t('common:voiceMicPermissionDenied'))
          return
        }
        toast.error(error.message ?? t('common:voiceError'))
        return
      }
      toast.error(t('common:voiceError'))
    }
  }, [serviceHub, t, navigate])

  const stop = useCallback(async () => {
    setState('transcribing')
    try {
      const text = await serviceHub.voice().stopRecording()
      insertTranscript(text)
    } catch (error) {
      // The silence auto-stop may have beaten the click — its transcript
      // arrives via the voice-transcript event, so a "not-recording"
      // rejection here is not an error worth surfacing.
      if (!isVoiceError(error) || error.kind !== 'not-recording') {
        toast.error(
          isVoiceError(error)
            ? (error.message ?? t('common:voiceError'))
            : t('common:voiceError')
        )
      }
    } finally {
      setState('idle')
      setLevel(0)
    }
  }, [serviceHub, insertTranscript, t])

  const cancel = useCallback(() => {
    serviceHub
      .voice()
      .cancelRecording()
      .catch((error) => console.error('Voice cancel failed:', error))
    setState('idle')
    setLevel(0)
  }, [serviceHub])

  const toggle = useCallback(() => {
    if (state === 'idle') void start()
    else if (state === 'recording') void stop()
    // transcribing: ignore clicks until inference finishes.
  }, [state, start, stop])

  // Subscribe to worker events: mic level, state transitions (keeps the UI
  // in sync with the silence auto-stop), and auto-stop transcripts.
  useEffect(() => {
    if (!visible) return
    const eventsService = serviceHub.events()
    if (!eventsService) return
    let unmounted = false
    const unlistens: Array<() => void> = []
    const safelyUnlisten = (unlisten: () => void) => {
      try {
        unlisten()
      } catch (error) {
        console.error('Failed to remove a voice event listener:', error)
      }
    }

    const subscribe = async () => {
      try {
        const registrations = await Promise.allSettled([
          eventsService.listen<{ level: number }>(
            VOICE_LEVEL_EVENT,
            (event) => {
              if (unmounted) return
              if (typeof event.payload?.level === 'number') {
                setLevel(event.payload.level)
              }
            }
          ),
          eventsService.listen<{ state: VoiceRecordingState }>(
            VOICE_STATE_EVENT,
            (event) => {
              if (unmounted) return
              const next = event.payload?.state
              if (
                next === 'idle' ||
                next === 'recording' ||
                next === 'transcribing'
              ) {
                setState(next)
                if (next === 'recording') setElapsedSeconds(0)
                else setLevel(0)
              }
            }
          ),
          eventsService.listen<{ text: string }>(
            VOICE_TRANSCRIPT_EVENT,
            (event) => {
              if (unmounted) return
              insertTranscript(event.payload?.text ?? '')
              setState('idle')
              setLevel(0)
            }
          ),
        ])
        const handles = registrations.flatMap((registration) =>
          registration.status === 'fulfilled' ? [registration.value] : []
        )
        for (const registration of registrations) {
          if (registration.status === 'rejected' && !unmounted) {
            console.error(
              'Failed to subscribe to a voice event:',
              registration.reason
            )
          }
        }
        if (unmounted) {
          handles.forEach(safelyUnlisten)
          return
        }
        unlistens.push(...handles)
      } catch (error) {
        if (!unmounted) {
          console.error('Failed to subscribe to voice events:', error)
        }
      }
    }
    void subscribe()

    return () => {
      unmounted = true
      unlistens.forEach(safelyUnlisten)
    }
  }, [visible, serviceHub, insertTranscript])

  // Esc cancels an in-flight recording.
  useEffect(() => {
    if (state !== 'recording') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [state, cancel])

  // Elapsed seconds while recording.
  useEffect(() => {
    if (state !== 'recording') return
    const interval = setInterval(
      () => setElapsedSeconds((seconds) => seconds + 1),
      1000
    )
    return () => clearInterval(interval)
  }, [state])

  return { visible, state, level, elapsedSeconds, toggle, cancel }
}
