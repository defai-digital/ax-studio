import type { RefObject } from 'react'
import type { UIMessage } from '@ai-sdk/react'
import { cn } from '@/lib/utils'
import { MessageItem } from '@/containers/MessageItem'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { PromptProgress } from '@/components/PromptProgress'
import { Button } from '@/components/ui/button'
import { IconAlertCircle } from '@tabler/icons-react'
import { OUT_OF_CONTEXT_SIZE } from '@/utils/error'

const CHAT_STATUS = { SUBMITTED: 'submitted' } as const

export type MessagesAreaProps = {
  chatMessages: UIMessage[]
  status: string
  error?: Error | null
  threadId: string
  reasoningContainerRef: RefObject<HTMLDivElement>
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
  reasoningContainerRef,
  handleRegenerate,
  handleEditMessage,
  handleDeleteMessage,
  handleContextSizeIncrease,
  contentCls,
}: MessagesAreaProps) {
  return (
    <div className="flex-1 relative">
      <Conversation className="absolute inset-0 text-start">
        <ConversationContent className={cn(contentCls)}>
          {chatMessages.map((message, index) => (
            <MessageItem
              key={message.id}
              message={message}
              isFirstMessage={index === 0}
              isLastMessage={index === chatMessages.length - 1}
              status={status}
              threadId={threadId}
              reasoningContainerRef={reasoningContainerRef}
              onRegenerate={handleRegenerate}
              onEdit={handleEditMessage}
              onDelete={handleDeleteMessage}
            />
          ))}
          {status === CHAT_STATUS.SUBMITTED && <PromptProgress />}
          {error && (
            <div className="px-4 py-3 mx-4 my-2 rounded-lg border border-destructive/10 bg-destructive/10">
              <div className="flex items-start gap-3">
                <IconAlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-destructive mb-1">Error generating response</p>
                  <p className="text-sm text-muted-foreground">{error.message}</p>
                  {((error.message?.toLowerCase().includes('context') &&
                    (error.message?.toLowerCase().includes('size') ||
                      error.message?.toLowerCase().includes('length') ||
                      error.message?.toLowerCase().includes('limit'))) ||
                    error.message === OUT_OF_CONTEXT_SIZE) && handleContextSizeIncrease ? (
                    <Button variant="outline" size="sm" className="mt-3" onClick={handleContextSizeIncrease}>
                      <IconAlertCircle className="size-4 mr-2" />Increase Context Size
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
    </div>
  )
}
