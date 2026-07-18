/**
 * CompareComposer — single shared input for compare mode.
 *
 * Deliberately minimal (text only, no attachments/tools): submitting fans the
 * prompt out to both compare threads through each pane's existing send path.
 * Stop/regenerate stay per-pane.
 */
import { useCallback, useState } from 'react'
import TextareaAutosize from 'react-textarea-autosize'
import { ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'

type CompareComposerProps = {
  /** Display label for the left pane's model. */
  modelALabel: string
  /** Display label for the right pane's model. */
  modelBLabel: string
  /** Disable input + send while either pane is generating. */
  disabled?: boolean
  onSubmit: (text: string) => void
}

export function CompareComposer({
  modelALabel,
  modelBLabel,
  disabled = false,
  onSubmit,
}: CompareComposerProps) {
  const [value, setValue] = useState('')

  const submit = useCallback(() => {
    const text = value.trim()
    if (!text || disabled) return
    onSubmit(text)
    setValue('')
  }, [value, disabled, onSubmit])

  return (
    <div className="px-2 pb-2 shrink-0" data-testid="compare-composer">
      <div className="rounded-2xl border border-input bg-white dark:bg-zinc-900">
        <div className="flex items-center gap-2 px-4 pt-2 text-xs text-muted-foreground">
          <span className="truncate">
            Left: <span className="font-medium">{modelALabel}</span>
          </span>
          <span aria-hidden="true">·</span>
          <span className="truncate">
            Right: <span className="font-medium">{modelBLabel}</span>
          </span>
        </div>
        <div className="flex items-end gap-2 px-2 pb-2">
          <TextareaAutosize
            minRows={2}
            maxRows={8}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              const isComposing =
                e.nativeEvent.isComposing || e.keyCode === 229
              if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder="Send the same message to both models"
            aria-label="Compare models composer"
            disabled={disabled}
            className="flex-1 bg-transparent pt-2 border-none resize-none outline-0 px-2 break-words text-[14px] disabled:opacity-50"
          />
          <Button
            size="icon-sm"
            className="mb-1 shrink-0"
            aria-label="Send to both models"
            onClick={submit}
            disabled={disabled || !value.trim()}
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
