/**
 * VoiceMicButton — composer toolbar control for on-device dictation.
 *
 * idle: plain mic icon. recording: pulsing red mic (click again to stop &
 * transcribe) + elapsed time + mic level bar + cancel button (Esc works
 * too). transcribing: spinner. Pure UI — all state lives in useVoiceInput.
 */

import { memo } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Loader2, Mic, X } from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import type { VoiceRecordingState } from '@/services/voice/types'

type Props = {
  state: VoiceRecordingState
  /** Mic RMS level 0..1, shown as a bar while recording. */
  level: number
  elapsedSeconds: number
  onToggle: () => void
  onCancel: () => void
}

/** m:ss formatting for the recording elapsed time. */
const formatVoiceElapsed = (seconds: number): string => {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export const VoiceMicButton = memo(function VoiceMicButton({
  state,
  level,
  elapsedSeconds,
  onToggle,
  onCancel,
}: Props) {
  const { t } = useTranslation()

  if (state === 'transcribing') {
    return (
      <div
        className="flex items-center gap-1.5 mr-1 mb-1"
        data-testid="voice-transcribing"
      >
        <Loader2 size={16} className="animate-spin text-muted-foreground" />
        <span className="hidden sm:inline text-xs text-muted-foreground">
          {t('common:voiceTranscribing')}
        </span>
      </div>
    )
  }

  if (state === 'recording') {
    const levelPercent = Math.min(100, Math.round(level * 100))
    return (
      <div className="flex items-center gap-1.5 mr-1 mb-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('common:voiceCancel')}
              title={t('common:voiceCancel')}
              data-testid="voice-cancel-button"
              onClick={onCancel}
            >
              <X size={16} className="text-muted-foreground" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('common:voiceCancelHint')}</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('common:voiceStop')}
              aria-pressed={true}
              title={t('common:voiceStop')}
              data-testid="voice-mic-button"
              data-state="recording"
              onClick={onToggle}
              className="animate-pulse"
            >
              <Mic size={18} className="text-red-500" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{t('common:voiceStopHint')}</p>
          </TooltipContent>
        </Tooltip>

        <span
          className="text-xs tabular-nums text-red-500/90"
          data-testid="voice-elapsed"
        >
          {formatVoiceElapsed(elapsedSeconds)}
        </span>

        <div
          className="h-1 w-10 rounded-full bg-muted overflow-hidden"
          data-testid="voice-level-bar"
          role="presentation"
        >
          <div
            className={cn(
              'h-full rounded-full bg-red-500 transition-[width] duration-100'
            )}
            style={{ width: `${levelPercent}%` }}
          />
        </div>
      </div>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('common:voiceInput')}
          aria-pressed={false}
          title={t('common:voiceInput')}
          data-testid="voice-mic-button"
          data-state="idle"
          onClick={onToggle}
          className="mr-1 mb-1"
        >
          <Mic size={18} className="text-muted-foreground" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{t('common:voiceInputHint')}</p>
      </TooltipContent>
    </Tooltip>
  )
})
