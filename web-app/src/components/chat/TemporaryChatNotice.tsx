/**
 * TemporaryChatNotice — low-key status strip shown above the composer while a
 * temporary chat is active (toggle on at Home, or viewing the temporary-chat
 * thread). Follows the Msty Vapor Mode / ChatGPT Temporary Chat convention:
 * muted text, dashed border, no loud colors.
 */
import { EyeOff } from 'lucide-react'

export function TemporaryChatNotice() {
  return (
    <div
      role="status"
      data-testid="temporary-chat-notice"
      className="mb-2 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/30 px-3 py-1.5 text-xs text-muted-foreground"
    >
      <EyeOff className="size-3.5" aria-hidden />
      <span>Temporary chat — this conversation won't be saved</span>
    </div>
  )
}
