import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { PlatformMetaKey } from '@/components/common/PlatformMetaKey'
import { acceleratorFromEvent, acceleratorToKeys } from '@/lib/shortcuts'
import { useTranslation } from '@/i18n/react-i18next-compat'

interface ShortcutRecorderProps {
  /** Current accelerator in Tauri format (e.g. "CmdOrCtrl+Shift+Space"). */
  value: string
  /**
   * Attempt to register a new accelerator. Must reject when registration
   * fails (e.g. combo taken by another app) so the error can be shown inline.
   */
  onRemap: (accelerator: string) => Promise<void>
}

/** Renders an accelerator string as a sequence of key badges. */
export function AcceleratorKeys({ accelerator }: { accelerator: string }) {
  return (
    <KbdGroup>
      {acceleratorToKeys(accelerator).map((part) => (
        <Kbd key={part}>{part === 'CmdOrCtrl' ? <PlatformMetaKey /> : part}</Kbd>
      ))}
    </KbdGroup>
  )
}

/**
 * Record-to-remap input for the global wake hotkey. Click "Change", press the
 * new combo, Esc cancels. Pure modifier presses are ignored (keep recording).
 */
export function ShortcutRecorder({ value, onRemap }: ShortcutRecorderProps) {
  const { t } = useTranslation()
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleKeyDown = async (event: React.KeyboardEvent) => {
    if (!recording) return
    event.preventDefault()
    event.stopPropagation()

    if (event.key === 'Escape') {
      setRecording(false)
      return
    }

    const accelerator = acceleratorFromEvent(event)
    if (!accelerator) return // pure modifier — keep recording

    try {
      await onRemap(accelerator)
      setError(null)
    } catch {
      setError(t('settings:shortcuts.quickLaunchError'))
    }
    setRecording(false)
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {recording ? (
        <Button
          variant="outline"
          size="sm"
          autoFocus
          onKeyDown={handleKeyDown}
          onBlur={() => setRecording(false)}
        >
          {t('settings:shortcuts.quickLaunchRecording')}
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <AcceleratorKeys accelerator={value} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setError(null)
              setRecording(true)
            }}
          >
            {t('settings:shortcuts.quickLaunchChange')}
          </Button>
        </div>
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  )
}
