/**
 * ThreadView — layout component for the ThreadDetail route.
 *
 * Renders the full page chrome: header, toolbar, chat pane, split view,
 * compare mode (two model-bound panes + one shared composer), research side
 * panels. No data-fetching — receives everything it needs as props.
 */
import { useCallback, useRef, useState, type RefObject } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { UIMessage } from '@ai-sdk/react'
import type { ChatStatus } from 'ai'
import { HeaderPage } from '@/containers/HeaderPage'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SplitThreadContainer } from '@/containers/threads/SplitThreadContainer'
import { MainThreadPane } from '@/containers/threads/MainThreadPane'
import { CompareModelsDialog } from '@/containers/threads/CompareModelsDialog'
import { CompareComposer } from '@/containers/threads/CompareComposer'
import { Columns2, MessageSquareText } from 'lucide-react'

export type ThreadViewProps = {
  threadId: string
  thread: Thread | undefined
  threadModel: Thread['model'] | undefined
  threadLogo: string
  chatMessages: UIMessage[]
  status: ChatStatus
  error: Error | null | undefined
  stop: () => void
  handleSubmit: (text: string) => Promise<void>
  handleRegenerate: (messageId?: string) => void
  handleEditMessage: (messageId: string, newText: string) => void
  handleDeleteMessage: (messageId: string) => void
  handleSwitchVersion: (groupId: string, direction: 'prev' | 'next') => void
  handleContextSizeIncrease: () => Promise<void>
  reasoningContainerRef: RefObject<HTMLDivElement | null>
  splitPaneOrder: string[] | null
  splitThreadId: string | null
  handleSplit: (dir: 'left' | 'right') => Promise<void>
  /** Compare mode: models bound to [main pane, split pane], null when off. */
  compareModels: [ThreadModel, ThreadModel] | null
  handleCompare: (modelA: ThreadModel, modelB: ThreadModel) => Promise<void>
  closeSplit: () => void
  showThreadPromptEditor: boolean
  setShowThreadPromptEditor: (show: boolean | ((v: boolean) => boolean)) => void
  threadPromptDraft: string
  setThreadPromptDraft: (draft: string) => void
  promptResolution: { source: string; resolvedPrompt: string }
  updateThread: (id: string, updates: Partial<Thread>) => void
}

export function ThreadView({
  threadId,
  thread,
  threadModel,
  threadLogo,
  chatMessages,
  status,
  error,
  stop,
  handleSubmit,
  handleRegenerate,
  handleEditMessage,
  handleDeleteMessage,
  handleSwitchVersion,
  handleContextSizeIncrease,
  reasoningContainerRef,
  splitPaneOrder,
  splitThreadId,
  handleSplit,
  compareModels,
  handleCompare,
  closeSplit,
  showThreadPromptEditor,
  setShowThreadPromptEditor,
  threadPromptDraft,
  setThreadPromptDraft,
  promptResolution,
  updateThread,
}: ThreadViewProps) {
  const navigate = useNavigate()
  const [compareDialogOpen, setCompareDialogOpen] = useState(false)
  // The split pane's own submit handler, registered by SplitThreadContainer
  // while compare mode is active. Sending from the shared composer is two
  // independent calls through each thread's existing send path.
  const splitSendRef = useRef<((text: string) => Promise<void>) | null>(null)
  const [splitBusy, setSplitBusy] = useState(false)

  const registerSplitSend = useCallback(
    (send: ((text: string) => Promise<void>) | null) => {
      splitSendRef.current = send
    },
    []
  )

  const compareActive = Boolean(compareModels && splitPaneOrder && splitThreadId)
  const mainBusy = status === 'submitted' || status === 'streaming'

  const handleCompareSubmit = useCallback(
    async (text: string) => {
      const sends: Promise<void>[] = [handleSubmit(text)]
      const splitSend = splitSendRef.current
      if (splitSend) sends.push(splitSend(text))
      // Independent calls: one pane failing must not cancel the other.
      await Promise.allSettled(sends)
    },
    [handleSubmit]
  )

  const renderSplitPane = (pane: string, compare: boolean) =>
    pane === 'main' ? (
      <div key="main-pane" className="relative h-full">
        <MainThreadPane
          threadId={threadId}
          thread={thread}
          threadLogo={threadLogo}
          chatMessages={chatMessages}
          status={status}
          error={error}
          stop={stop}
          threadModel={threadModel}
          handleSubmit={handleSubmit}
          handleRegenerate={handleRegenerate}
          handleEditMessage={handleEditMessage}
          handleDeleteMessage={handleDeleteMessage}
          handleSwitchVersion={handleSwitchVersion}
          handleContextSizeIncrease={handleContextSizeIncrease}
          reasoningContainerRef={reasoningContainerRef}
          showThreadPromptEditor={showThreadPromptEditor}
          setShowThreadPromptEditor={setShowThreadPromptEditor}
          threadPromptDraft={threadPromptDraft}
          setThreadPromptDraft={setThreadPromptDraft}
          promptResolution={promptResolution}
          updateThread={updateThread}
          isSplitView
          hideComposer={compare}
          headerBadge={compare && compareModels ? compareModels[0].id : undefined}
          onSplitClose={() => {
            if (!splitThreadId) return
            closeSplit()
            navigate({
              to: '/threads/$threadId',
              params: { threadId: splitThreadId },
            })
          }}
        />
      </div>
    ) : (
      <SplitThreadContainer
        key="split-pane"
        threadId={splitThreadId!}
        onClose={closeSplit}
        hideComposer={compare}
        headerBadge={compare && compareModels ? compareModels[1].id : undefined}
        registerSend={compare ? registerSplitSend : undefined}
        onBusyChange={compare ? setSplitBusy : undefined}
      />
    )

  return (
    <div className="flex flex-col h-[calc(100dvh-(env(safe-area-inset-bottom)+env(safe-area-inset-top)))]">
      <HeaderPage>
        <div className="flex items-center w-full pr-4">
          <div className="flex items-center gap-1 ml-auto shrink-0">
            {!splitPaneOrder && (
              <Button
                variant={showThreadPromptEditor ? 'secondary' : 'ghost'}
                size="icon-sm"
                aria-label="Thread Prompt"
                title="Thread Prompt"
                onClick={() => setShowThreadPromptEditor((v) => !v)}
              >
                <MessageSquareText className="size-4" />
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Split View"
                  title="Split View"
                >
                  <Columns2 className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => handleSplit('left')}>
                  Split Left
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleSplit('right')}>
                  Split Right
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setCompareDialogOpen(true)}>
                  Compare models
                </DropdownMenuItem>
                {splitPaneOrder && (
                  <DropdownMenuItem onSelect={closeSplit}>
                    Close Split View
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </HeaderPage>
      <div className="flex flex-1 flex-col h-full overflow-hidden">
        <div className="px-4 md:px-8 shrink-0">
          {!splitPaneOrder && showThreadPromptEditor && (
            <div className="mx-auto w-full md:w-4/5 xl:w-4/6 mt-2 rounded-md border bg-card p-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                {promptResolution.source === 'thread'
                  ? 'Using Thread Prompt'
                  : promptResolution.source === 'project'
                    ? 'Inheriting from Project Prompt'
                    : promptResolution.source === 'global'
                      ? 'Inheriting from Global Prompt'
                      : 'Using Fallback Prompt'}
              </p>
              <Textarea
                value={threadPromptDraft}
                onChange={(e) => setThreadPromptDraft(e.target.value)}
                className="min-h-24"
                placeholder="Leave empty to inherit from project/global."
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setThreadPromptDraft('')
                    updateThread(threadId, {
                      metadata: { ...thread?.metadata, threadPrompt: null },
                    })
                  }}
                >
                  Clear Override
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    updateThread(threadId, {
                      metadata: {
                        ...thread?.metadata,
                        threadPrompt: threadPromptDraft.trim() || null,
                      },
                    })
                    setShowThreadPromptEditor(false)
                  }}
                >
                  Save
                </Button>
              </div>
            </div>
          )}
        </div>

        {splitPaneOrder && splitThreadId ? (
          compareActive && compareModels ? (
            <div className="flex flex-col h-full overflow-hidden">
              <div className="grid grid-cols-2 gap-2 px-2 pb-2 flex-1 min-h-0">
                {splitPaneOrder.map((pane) => renderSplitPane(pane, true))}
              </div>
              <CompareComposer
                modelALabel={compareModels[0].id}
                modelBLabel={compareModels[1].id}
                disabled={mainBusy || splitBusy}
                onSubmit={handleCompareSubmit}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 px-2 pb-2 h-full">
              {splitPaneOrder.map((pane) => renderSplitPane(pane, false))}
            </div>
          )
        ) : (
          <div className="flex flex-1 flex-col h-full overflow-hidden">
            <MainThreadPane
              threadId={threadId}
              thread={thread}
              threadLogo={threadLogo}
              chatMessages={chatMessages}
              status={status}
              error={error}
              stop={stop}
              threadModel={threadModel}
              handleSubmit={handleSubmit}
              handleRegenerate={handleRegenerate}
              handleEditMessage={handleEditMessage}
              handleDeleteMessage={handleDeleteMessage}
              handleSwitchVersion={handleSwitchVersion}
              handleContextSizeIncrease={handleContextSizeIncrease}
              reasoningContainerRef={reasoningContainerRef}
              showThreadPromptEditor={false}
              setShowThreadPromptEditor={setShowThreadPromptEditor}
              threadPromptDraft={threadPromptDraft}
              setThreadPromptDraft={setThreadPromptDraft}
              promptResolution={promptResolution}
              updateThread={updateThread}
            />
          </div>
        )}
      </div>
      <CompareModelsDialog
        open={compareDialogOpen}
        onOpenChange={setCompareDialogOpen}
        defaultModelA={threadModel}
        onConfirm={handleCompare}
      />
    </div>
  )
}
