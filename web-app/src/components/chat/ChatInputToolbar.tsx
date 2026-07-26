/**
 * ChatInputToolbar — the bottom action bar of ChatInput.
 *
 * Renders: attachment dropdown, capability indicators, token counter, and the
 * send/stop button. Pure UI — no data fetching.
 */
import { memo, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ArrowUp,
  Atom,
  Binary,
  EyeOff,
  ImagePlus,
  Loader2,
  Paperclip,
  PlusIcon,
  Square,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { TokenCounter } from '@/components/TokenCounter'
import type { ThreadMessage } from '@ax-studio/core'

type ToolbarIndicatorProps = {
  icon: LucideIcon
  tooltip: ReactNode
  iconClassName?: string
}

// A read-only capability indicator. Looks like a chip, not a button, so it
// doesn't misrepresent a passive "this model supports X" signal as an action.
function ToolbarIndicator({
  icon: Icon,
  tooltip,
  iconClassName,
}: ToolbarIndicatorProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex size-6 items-center justify-center rounded-md cursor-default">
          <Icon size={16} className={iconClassName} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

type Props = {
  // Layout state
  isStreaming: boolean
  prompt: string
  // Model selector — rendered at the far left of the toolbar (in the composer,
  // where competitors put it) rather than in the page header.
  modelSelector?: ReactNode
  // Model capabilities
  selectedModel: Model | undefined
  projectId?: string
  initialMessage?: boolean
  effectiveThreadId?: string
  // Temporary chat (new-chat composer only)
  temporaryChatEnabled?: boolean
  onToggleTemporaryChat?: () => void
  // Token counter
  tokenCounterCompact: boolean
  threadMessages: ThreadMessage[]
  // Actions
  stopStreaming: (threadId: string) => void
  handleSendMessage: (prompt: string) => Promise<void>
  submitCurrentPrompt?: () => void
  onAttachDocuments?: () => void
  onAttachImages?: () => void
  ingestingDocs?: boolean
}

export const ChatInputToolbar = memo(function ChatInputToolbar({
  isStreaming,
  prompt,
  modelSelector,
  selectedModel,
  projectId,
  initialMessage,
  effectiveThreadId,
  temporaryChatEnabled = false,
  onToggleTemporaryChat,
  tokenCounterCompact,
  threadMessages,
  stopStreaming,
  handleSendMessage,
  submitCurrentPrompt,
  onAttachDocuments,
  onAttachImages,
  ingestingDocs,
}: Props) {
  const { t } = useTranslation()

  return (
    <div className="absolute z-20 bg-transparent bottom-0 w-full px-2 pb-2 pt-1">
      <div className="flex items-center w-full gap-2 overflow-hidden">
        {/* Left: model selector + action buttons */}
        <div className="px-1 flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
          {modelSelector && (
            <div className="min-w-0 max-w-[210px] shrink">{modelSelector}</div>
          )}
          <div
            className={cn(
              'px-1 flex items-center min-w-0 gap-1 shrink-0',
              isStreaming && 'opacity-50 pointer-events-none'
            )}
          >
            {/* Attachment + quick-prompt dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon-sm"
                  className="rounded-full mr-2 mb-1"
                  aria-label={t('common:attach')}
                  title={t('common:attach')}
                >
                  <PlusIcon size={18} className="text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {onAttachDocuments && (
                  <DropdownMenuItem
                    onClick={onAttachDocuments}
                    disabled={ingestingDocs}
                  >
                    {ingestingDocs ? (
                      <Loader2
                        size={18}
                        className="text-muted-foreground animate-spin"
                      />
                    ) : (
                      <Paperclip size={18} className="text-muted-foreground" />
                    )}
                    <span>
                      {ingestingDocs
                        ? 'Indexing documents...'
                        : 'Attach Document'}
                    </span>
                  </DropdownMenuItem>
                )}
                {onAttachImages && (
                  <DropdownMenuItem onClick={onAttachImages}>
                    <ImagePlus size={18} className="text-muted-foreground" />
                    <span>Attach Image</span>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {selectedModel?.capabilities?.includes('embeddings') && (
              <ToolbarIndicator
                icon={Binary}
                iconClassName="text-muted-foreground/70"
                tooltip={<p>{t('embeddings')}</p>}
              />
            )}

            {/* Temporary chat toggle — only on the new-chat composer. While
                viewing an existing thread there is no mid-thread mode switch;
                the user starts a temporary chat from Home instead. */}
            {initialMessage && !projectId && onToggleTemporaryChat && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Temporary chat"
                    aria-pressed={temporaryChatEnabled}
                    title="Temporary chat"
                    data-testid="temporary-chat-toggle"
                    onClick={onToggleTemporaryChat}
                  >
                    <EyeOff
                      size={18}
                      className={cn(
                        temporaryChatEnabled
                          ? 'text-primary'
                          : 'text-muted-foreground'
                      )}
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>
                    {temporaryChatEnabled
                      ? 'Temporary chat on — conversations won\'t be saved'
                      : 'Temporary chat'}
                  </p>
                </TooltipContent>
              </Tooltip>
            )}

            {selectedModel?.capabilities?.includes('reasoning') && (
              <ToolbarIndicator
                icon={Atom}
                iconClassName="text-muted-foreground/70"
                tooltip={<p>{t('reasoning')}</p>}
              />
            )}
          </div>
        </div>

        {/* Right: keyboard hints + token counter + send/stop */}
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="hidden xl:flex items-center gap-2 text-xs text-muted-foreground/70 mr-1 whitespace-nowrap">
            <span>{t('common:sendHint')}</span>
            <span>{t('common:newlineHint')}</span>
          </div>

          {tokenCounterCompact &&
            !initialMessage &&
            (threadMessages?.length > 0 || prompt.trim().length > 0) && (
              <div className="hidden md:flex shrink-0 justify-center">
                <TokenCounter messages={threadMessages || []} />
              </div>
            )}

          {isStreaming ? (
            <Button
              variant="destructive"
              size="icon-sm"
              className="rounded-full mr-1 mb-1"
              aria-label={t('common:stop')}
              title={t('common:stop')}
              onClick={() => {
                if (effectiveThreadId) stopStreaming(effectiveThreadId)
              }}
            >
              <Square />
            </Button>
          ) : (
            <Button
              variant="default"
              size="icon-sm"
              disabled={ingestingDocs}
              data-test-id="send-message-button"
              aria-label={t('common:sendMessage')}
              title={t('common:sendMessage')}
              onClick={() => {
                if (submitCurrentPrompt) {
                  submitCurrentPrompt()
                } else {
                  void handleSendMessage(prompt)
                }
              }}
              className="rounded-full mr-1 mb-1 bg-brand-gradient text-primary-foreground border-0 shadow-sm hover:opacity-90"
            >
              <ArrowUp className="text-primary-foreground" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
})
