import type { RefObject } from 'react'
import type { UIMessage } from '@ai-sdk/react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import ChatInput from '@/containers/ChatInput'
import { MessagesArea } from './MessagesArea'

export type MainThreadPaneProps = {
  threadId: string
  thread: Thread | undefined
  threadLogo: string
  chatMessages: UIMessage[]
  status: string
  error?: Error | null
  stop: () => void
  threadModel: Thread['model'] | undefined
  handleSubmit: (text: string) => Promise<void>
  handleRegenerate: (messageId?: string) => void
  handleEditMessage: (messageId: string, newText: string) => void
  handleDeleteMessage: (messageId: string) => void
  handleContextSizeIncrease?: () => Promise<void>
  reasoningContainerRef: RefObject<HTMLDivElement>
  showThreadPromptEditor: boolean
  setShowThreadPromptEditor: (show: boolean | ((v: boolean) => boolean)) => void
  threadPromptDraft: string
  setThreadPromptDraft: (draft: string) => void
  promptResolution: { source: string; resolvedPrompt: string }
  updateThread: (id: string, updates: Partial<Thread>) => void
  hasPanels?: boolean
  isSplitView?: boolean
  onSplitClose?: () => void
}

export function MainThreadPane({
  threadId,
  thread,
  threadLogo,
  chatMessages,
  status,
  error,
  stop,
  threadModel,
  handleSubmit,
  handleRegenerate,
  handleEditMessage,
  handleDeleteMessage,
  handleContextSizeIncrease,
  reasoningContainerRef,
  showThreadPromptEditor,
  setShowThreadPromptEditor,
  threadPromptDraft,
  setThreadPromptDraft,
  promptResolution,
  updateThread,
  hasPanels = false,
  isSplitView = false,
  onSplitClose,
}: MainThreadPaneProps) {
  const containerCls = isSplitView
    ? 'h-full rounded-md border bg-background overflow-hidden flex flex-col relative'
    : hasPanels
      ? 'h-full rounded-md border bg-background overflow-hidden flex flex-col'
      : 'flex flex-1 flex-col h-full overflow-hidden'

  const contentCls = isSplitView || hasPanels ? 'mx-auto w-full px-2' : 'mx-auto w-full md:w-4/5 xl:w-4/6'
  const inputCls = isSplitView || hasPanels ? 'p-2' : 'py-4 mx-auto w-full md:w-4/5 xl:w-4/6'

  const title = thread?.title || (isSplitView ? 'Current Thread' : 'New Thread')

  return (
    <div className={containerCls}>
      {/* Split-view pane header */}
      {isSplitView && (
        <div className="px-3 py-2 border-b text-sm font-medium truncate">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {threadLogo && (
                <img src={threadLogo} alt={title} className="size-5 rounded-sm object-cover shrink-0" />
              )}
              <span className="truncate">{title}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button variant="outline" size="sm" onClick={() => setShowThreadPromptEditor((v) => !v)}>
                Thread Prompt
              </Button>
              <Button variant="ghost" size="icon-xs" className="shrink-0" onClick={onSplitClose}>
                <span className="size-4">✕</span>
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* Thread prompt editor (split view only) */}
      {isSplitView && showThreadPromptEditor && (
        <div className="border-b p-2 space-y-2">
          <p className="text-xs text-muted-foreground">
            {promptResolution.source === 'thread' ? 'Using Thread Prompt'
              : promptResolution.source === 'project' ? 'Inheriting from Project Prompt'
              : promptResolution.source === 'global' ? 'Inheriting from Global Prompt'
              : 'Using Fallback Prompt'}
          </p>
          <Textarea
            value={threadPromptDraft}
            onChange={(e) => setThreadPromptDraft(e.target.value)}
            className="min-h-20"
            placeholder="Leave empty to inherit from project/global."
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => {
              setThreadPromptDraft('')
              updateThread(threadId, { metadata: { ...thread?.metadata, threadPrompt: null } })
            }}>Clear Override</Button>
            <Button size="sm" onClick={() => {
              updateThread(threadId, { metadata: { ...thread?.metadata, threadPrompt: threadPromptDraft.trim() || null } })
              setShowThreadPromptEditor(false)
            }}>Save</Button>
          </div>
        </div>
      )}

      {/* Normal view: thread title header */}
      {!isSplitView && (() => {
        const firstUserMsg = chatMessages.find((m) => m.role === 'user')
        const firstMsgText = firstUserMsg?.parts
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text)
          .join('')
          .trim()
        const titleMatchesFirst = firstMsgText && title === firstMsgText
        if (titleMatchesFirst && !threadLogo) return null
        return (
          <div className="px-4 md:px-8 pb-2 shrink-0">
            <div className="mx-auto w-full md:w-4/5 xl:w-4/6 flex items-center gap-2 min-w-0">
              {threadLogo && (
                <img src={threadLogo} alt={title} className="size-5 rounded-sm object-cover shrink-0" />
              )}
              <h2 className="text-sm font-medium truncate">{title}</h2>
            </div>
          </div>
        )
      })()}

      {/* Messages + Input */}
      {isSplitView ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <MessagesArea
            chatMessages={chatMessages}
            status={status}
            error={error}
            threadId={threadId}
            reasoningContainerRef={reasoningContainerRef}
            handleRegenerate={handleRegenerate}
            handleEditMessage={handleEditMessage}
            handleDeleteMessage={handleDeleteMessage}
            handleContextSizeIncrease={handleContextSizeIncrease}
            contentCls={contentCls}
          />
          <div className={inputCls}>
            <ChatInput threadId={threadId} model={threadModel} onSubmit={handleSubmit} onStop={stop} chatStatus={status} />
          </div>
        </div>
      ) : (
        <>
          <MessagesArea
            chatMessages={chatMessages}
            status={status}
            error={error}
            threadId={threadId}
            reasoningContainerRef={reasoningContainerRef}
            handleRegenerate={handleRegenerate}
            handleEditMessage={handleEditMessage}
            handleDeleteMessage={handleDeleteMessage}
            handleContextSizeIncrease={handleContextSizeIncrease}
            contentCls={contentCls}
          />
          <div className={inputCls}>
            <ChatInput threadId={threadId} model={threadModel} onSubmit={handleSubmit} onStop={stop} chatStatus={status} />
          </div>
        </>
      )}
    </div>
  )
}
