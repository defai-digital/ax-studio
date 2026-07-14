/**
 * MessageRatingActions — thumbs up/down for an assistant message, with a
 * lightweight feedback-capture flow on thumbs-down (quick-reason chips + an
 * optional comment) so a downvote records *why*, not just a bare flag.
 */
import { useEffect, useState } from 'react'
import { Flag, ThumbsDown, ThumbsUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { AX_STUDIO_EXTERNAL_LINKS } from '@/constants/external-links'

export type MessageFeedback = {
  reasons?: string[]
  comment?: string
}

const DOWNVOTE_REASONS = [
  'Incorrect',
  'Not helpful',
  'Too long',
  "Didn't follow instructions",
  'Refused',
] as const

type Props = {
  rating: 'up' | 'down' | undefined
  feedback: MessageFeedback | undefined
  onRateUp: () => void
  onSubmitDownvote: (data: { reasons: string[]; comment: string }) => void
  onClearRating: () => void
}

export function MessageRatingActions({
  rating,
  feedback,
  onRateUp,
  onSubmitDownvote,
  onClearRating,
}: Props) {
  const [open, setOpen] = useState(false)
  const [reasons, setReasons] = useState<string[]>([])
  const [comment, setComment] = useState('')

  // Seed the form from any previously captured feedback whenever the popover opens.
  useEffect(() => {
    if (open) {
      setReasons(feedback?.reasons ?? [])
      setComment(feedback?.comment ?? '')
    }
  }, [open, feedback?.reasons, feedback?.comment])

  const toggleReason = (reason: string) => {
    setReasons((prev) =>
      prev.includes(reason)
        ? prev.filter((r) => r !== reason)
        : [...prev, reason]
    )
  }

  const submit = () => {
    onSubmitDownvote({ reasons, comment: comment.trim() })
    setOpen(false)
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        title="Good response"
        aria-label="Good response"
        className={cn(
          'text-muted-foreground/50 hover:text-emerald-500',
          rating === 'up' && 'text-emerald-500'
        )}
        onClick={onRateUp}
      >
        <ThumbsUp className="size-3.5" />
      </Button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            title="Poor response"
            aria-label="Poor response"
            className={cn(
              'text-muted-foreground/50 hover:text-rose-500',
              rating === 'down' && 'text-rose-500'
            )}
          >
            <ThumbsDown className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-72 p-3 space-y-3"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit()
          }}
        >
          <p className="text-xs font-medium">What went wrong?</p>
          <div className="flex flex-wrap gap-1.5">
            {DOWNVOTE_REASONS.map((reason) => {
              const active = reasons.includes(reason)
              return (
                <button
                  key={reason}
                  type="button"
                  onClick={() => toggleReason(reason)}
                  className={cn(
                    'text-[11px] px-2 py-1 rounded-full border transition-colors',
                    active
                      ? 'bg-rose-500/10 border-rose-500/40 text-rose-600 dark:text-rose-400'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  )}
                >
                  {reason}
                </button>
              )
            })}
          </div>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add details (optional)"
            className="min-h-16 text-xs"
          />
          <a
            href={AX_STUDIO_EXTERNAL_LINKS.aiContentReport}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Report inappropriate AI content"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(false)}
          >
            <Flag className="size-3.5" />
            Report inappropriate content
          </a>
          <div className="flex items-center justify-between">
            {rating === 'down' ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => {
                  onClearRating()
                  setOpen(false)
                }}
              >
                Remove
              </Button>
            ) : (
              <span />
            )}
            <Button size="sm" onClick={submit}>
              Submit
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}
