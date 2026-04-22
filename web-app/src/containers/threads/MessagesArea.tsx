import { type RefObject, useState, useEffect } from 'react'
import type { UIMessage } from '@ai-sdk/react'
import type { ChatStatus } from 'ai'
import { cn } from '@/lib/utils'
import { MessageItem } from '@/containers/MessageItem'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { PromptProgress } from '@/components/PromptProgress'
import { Button } from '@/components/ui/button'
import { OUT_OF_CONTEXT_SIZE } from '@/lib/utils/error'
import { safeStorageGetItem, safeStorageSetItem } from '@/lib/storage'
import { motion, AnimatePresence } from 'motion/react'
import { AlertCircle, GitBranch, X } from "lucide-react";

const CHAT_STATUS = { SUBMITTED: 'submitted' } as const

export type MessagesAreaProps = {
  chatMessages: UIMessage[]
  status: ChatStatus
  error?: Error | null
  threadId: string
  thread?: Thread
  reasoningContainerRef: RefObject<HTMLDivElement | null>
  handleRegenerate: (messageId?: string) => void
  handleEditMessage: (messageId: string, newText: string) => void
  handleDeleteMessage: (messageId: string) => void
  handleContextSizeIncrease?: () => Promise<void>
  contentCls: string
}

export function MessagesArea({
  chatMessages,
  status,
  error,
  threadId,
  thread,
  reasoningContainerRef,
  handleRegenerate,
  handleEditMessage,
  handleDeleteMessage,
  handleContextSizeIncrease,
  contentCls,
}: MessagesAreaProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const metadata = thread?.metadata as Record<string, any> | undefined
  const forkedFrom = metadata?.forkedFrom || metadata?.parentThreadId
  const bannerKey = `branch-banner-dismissed-${threadId}`
  const [bannerDismissed, setBannerDismissed] = useState(() =>
    safeStorageGetItem(sessionStorage, bannerKey, 'MessagesArea') === 'true'
  )

  // Reset dismissal when thread changes
  useEffect(() => {
    setBannerDismissed(
      safeStorageGetItem(sessionStorage, bannerKey, 'MessagesArea') === 'true'
    )
  }, [bannerKey])

  const dismissBanner = () => {
    safeStorageSetItem(sessionStorage, bannerKey, 'true', 'MessagesArea')
    setBannerDismissed(true)
  }

  return (
    <div className="flex-1 relative">
      <Conversation className="absolute inset-0 text-start">
        {/* Branch/Fork banner */}
        <AnimatePresence>
          {forkedFrom && !bannerDismissed && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center gap-3 px-4 py-2.5 bg-violet-500/5 border-b border-violet-500/15 text-[13px]"
            >
              <GitBranch className="size-3.5 text-violet-500 shrink-0" />
              <span className="text-foreground/70">
                Forked from:{' '}
                <span className="text-foreground font-medium">
                  &quot;{typeof forkedFrom === 'string' ? forkedFrom : 'parent conversation'}&quot;
                </span>
              </span>
              <button
                onClick={dismissBanner}
                className="ml-auto p-1 rounded-md hover:bg-violet-500/10 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <ConversationContent className={cn(contentCls, 'py-6')}>
          {chatMessages.map((message, index) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index < 3 ? index * 0.02 : 0 }}
            >
              <MessageItem
                message={message}
                isLastMessage={index === chatMessages.length - 1}
                status={status}
                threadId={threadId}
                reasoningContainerRef={reasoningContainerRef}
                onRegenerate={handleRegenerate}
                onEdit={handleEditMessage}
                onDelete={handleDeleteMessage}
              />
            </motion.div>
          ))}
          {status === CHAT_STATUS.SUBMITTED && <PromptProgress />}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="px-4 py-3 mx-4 my-2 rounded-xl border border-destructive/15 bg-destructive/5"
            >
              <div className="flex items-start gap-3">
                <AlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-destructive mb-1">Error generating response</p>
                  <p className="text-[13px] text-muted-foreground leading-relaxed">{error.message}</p>
                  {((error.message?.toLowerCase().includes('context') &&
                    (error.message?.toLowerCase().includes('size') ||
                      error.message?.toLowerCase().includes('length') ||
                      error.message?.toLowerCase().includes('limit'))) ||
                    error.message === OUT_OF_CONTEXT_SIZE) && handleContextSizeIncrease ? (
                    <Button variant="outline" size="sm" className="mt-3" onClick={handleContextSizeIncrease}>
                      <AlertCircle className="size-4 mr-2" />Increase Context Size
                    </Button>
                  ) : null}
                </div>
              </div>
            </motion.div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </div>
  )
}
