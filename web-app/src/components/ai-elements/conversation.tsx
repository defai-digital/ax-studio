import { ArrowDown } from "lucide-react";
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ComponentProps } from 'react'
import { useCallback, memo } from 'react'
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom'
import { AnimatePresence, motion } from 'motion/react'

type ConversationProps = ComponentProps<typeof StickToBottom>

export const Conversation = memo(({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn('relative flex-1 overflow-hidden [&>div]:!overflow-x-hidden', className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  />
))

Conversation.displayName = 'Conversation'

type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>

export const ConversationContent = memo(({ className, ...props }: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn('flex flex-col gap-x-8 gap-y-3 px-2 min-w-0', className)}
    scrollClassName="!overflow-x-hidden"
    {...props}
  />
))

ConversationContent.displayName = 'ConversationContent'

type ConversationScrollButtonProps = ComponentProps<typeof Button>

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext()

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom()
  }, [scrollToBottom])

  return (
    <AnimatePresence>
      {!isAtBottom && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 10 }}
          className="absolute bottom-4 left-[50%] translate-x-[-50%] z-20"
        >
          <Button
            className={cn(
              'rounded-full shadow-lg hover:shadow-xl transition-shadow flex items-center gap-1.5 text-[12px] text-muted-foreground',
              className
            )}
            onClick={handleScrollToBottom}
            size="sm"
            type="button"
            variant="outline"
            {...props}
          >
            <ArrowDown className="size-3.5" />
            Scroll to bottom
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
