import type { RefObject } from 'react'
import type { UIMessage } from '@ai-sdk/react'
import type { ChatStatus } from 'ai'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { MessageSquareText, Users } from 'lucide-react'
import ChatInput from '@/containers/ChatInput'
import { MessagesArea } from './MessagesArea'

export type MainThreadPaneProps = {
  threadId: string
  thread: Thread | undefined
  threadLogo: string
  chatMessages: UIMessage[]
  status: ChatStatus
  error?: Error | null
  stop: () => void
  threadModel: Thread['model'] | undefined
  handleSubmit: (text: string) => Promise<void>
  handleRegenerate: (messageId?: string) => void
  handleEditMessage: (messageId: string, newText: string) => void
  handleDeleteMessage: (messageId: string) => void
  handleContextSizeIncrease?: () => Promise<void>
  reasoningContainerRef: RefObject<HTMLDivElement | null>
  showThreadPromptEditor: boolean
  setShowThreadPromptEditor: (show: boolean | ((v: boolean) => boolean)) => void
  threadPromptDraft: string
  setThreadPromptDraft: (draft: string) => void
  promptResolution: { source: string; resolvedPrompt: string }
  updateThread: (id: string, updates: Partial<Thread>) => void
  hasPanels?: boolean
  isSplitView?: boolean
  onSplitClose?: () => void
  // Team selector (split view only)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agentTeams?: any[]
  activeTeamId?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  activeTeam?: any
  handleTeamChange?: (teamId: string | undefined) => void
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
  agentTeams = [],
  activeTeamId,
  activeTeam,
  handleTeamChange,
}: MainThreadPaneProps) {
  const containerCls = isSplitView
    ? 'h-full rounded-xl border bg-background overflow-hidden flex flex-col relative'
    : hasPanels
      ? 'h-full rounded-xl border bg-background overflow-hidden flex flex-col'
      : 'flex flex-1 flex-col h-full overflow-hidden'

  const contentCls = isSplitView || hasPanels ? 'mx-auto w-full px-2' : 'mx-auto w-full max-w-2xl px-4 sm:px-6'
  const inputCls = isSplitView || hasPanels ? 'p-2' : 'py-4 mx-auto w-full max-w-2xl px-4 sm:px-6'

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
            <div className="flex items-center gap-0.5 shrink-0">
              {handleTeamChange && (
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button variant={activeTeamId ? 'secondary' : 'ghost'} size="icon-xs">
                          <Users className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{activeTeam ? activeTeam.name : 'Agent Team'}</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => handleTeamChange(undefined)}>
                      No Team (single agent)
                    </DropdownMenuItem>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {agentTeams.map((team: any) => (
                      <DropdownMenuItem key={team.id} onSelect={() => handleTeamChange(team.id)}>
                        {team.name}{team.id === activeTeamId && ' ✓'}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={showThreadPromptEditor ? 'secondary' : 'ghost'}
                    size="icon-xs"
                    onClick={() => setShowThreadPromptEditor((v) => !v)}
                  >
                    <MessageSquareText className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Thread Prompt</TooltipContent>
              </Tooltip>
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
          <div className="px-4 sm:px-6 pb-2 shrink-0">
            <div className="mx-auto w-full max-w-2xl flex items-center gap-2 min-w-0">
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
            thread={thread}
            reasoningContainerRef={reasoningContainerRef}
            handleRegenerate={handleRegenerate}
            handleEditMessage={handleEditMessage}
            handleDeleteMessage={handleDeleteMessage}
            handleContextSizeIncrease={handleContextSizeIncrease}
            contentCls={contentCls}
          />
          <div className="relative">
            <div
              className="absolute -top-8 left-0 right-0 h-8 pointer-events-none z-10"
              style={{ background: 'linear-gradient(to top, var(--background) 20%, transparent)' }}
            />
            <div className={inputCls}>
              <ChatInput threadId={threadId} model={threadModel} onSubmit={handleSubmit} onStop={stop} chatStatus={status} />
            </div>
          </div>
        </div>
      ) : (
        <>
          <MessagesArea
            chatMessages={chatMessages}
            status={status}
            error={error}
            threadId={threadId}
            thread={thread}
            reasoningContainerRef={reasoningContainerRef}
            handleRegenerate={handleRegenerate}
            handleEditMessage={handleEditMessage}
            handleDeleteMessage={handleDeleteMessage}
            handleContextSizeIncrease={handleContextSizeIncrease}
            contentCls={contentCls}
          />
          <div className="relative">
            {/* Gradient fade from messages to input */}
            <div
              className="absolute -top-8 left-0 right-0 h-8 pointer-events-none z-10"
              style={{ background: 'linear-gradient(to top, var(--background) 20%, transparent)' }}
            />
            <div className={inputCls}>
              <ChatInput threadId={threadId} model={threadModel} onSubmit={handleSubmit} onStop={stop} chatStatus={status} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
