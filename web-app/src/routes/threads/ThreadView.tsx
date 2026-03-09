/**
 * ThreadView — pure layout component for the ThreadDetail route.
 *
 * Renders the full page chrome: header, toolbar, chat pane, split view,
 * artifact/research side panels, and modals. No data-fetching or business
 * logic — receives everything it needs as props.
 */
import type { RefObject } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import type { UIMessage } from '@ai-sdk/react'
import HeaderPage from '@/containers/HeaderPage'
import ChatInput from '@/containers/ChatInput'
import { MessageItem } from '@/containers/MessageItem'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { PromptProgress } from '@/components/PromptProgress'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { IconAlertCircle } from '@tabler/icons-react'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ArtifactPanel } from '@/components/ai-elements/ArtifactPanel'
import { ResearchPanel } from '@/components/research/ResearchPanel'
import { TeamVariablePrompt } from '@/components/TeamVariablePrompt'
import { CostApprovalModal } from '@/components/CostApprovalModal'
import { SplitThreadPane } from './SplitThreadPane'
import { Columns2, X } from 'lucide-react'
import { OUT_OF_CONTEXT_SIZE } from '@/utils/error'
import { toast } from 'sonner'

const CHAT_STATUS = { SUBMITTED: 'submitted' } as const

type FileItem = { type: string; mediaType: string; url: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentTeam = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CostApprovalState = any | null

export type ThreadViewProps = {
  threadId: string
  thread: Thread | undefined
  threadModel: Thread['model'] | undefined
  threadLogo: string
  chatMessages: UIMessage[]
  status: string
  error: Error | null | undefined
  stop: () => void
  handleSubmit: (text: string, files?: FileItem[]) => Promise<void>
  handleRegenerate: (messageId?: string) => void
  handleEditMessage: (messageId: string, newText: string) => void
  handleDeleteMessage: (messageId: string) => void
  handleContextSizeIncrease: () => Promise<void>
  reasoningContainerRef: RefObject<HTMLDivElement>
  pinnedArtifact: boolean | undefined
  clearArtifact: (threadId: string) => void
  pinnedResearch: boolean | undefined
  clearResearch: (threadId: string) => void
  splitPaneOrder: string[] | null
  splitThreadId: string | null
  setSplitThreadId: (id: string | null) => void
  setSplitDirection: (dir: 'left' | 'right' | null) => void
  handleSplit: (dir: 'left' | 'right') => Promise<void>
  showThreadPromptEditor: boolean
  setShowThreadPromptEditor: (show: boolean | ((v: boolean) => boolean)) => void
  threadPromptDraft: string
  setThreadPromptDraft: (draft: string) => void
  showPromptDebug: boolean
  setShowPromptDebug: (show: boolean | ((v: boolean) => boolean)) => void
  promptResolution: { source: string; resolvedPrompt: string }
  optimizedModelConfig: {
    temperature?: number
    top_p?: number
    max_output_tokens?: number
    modelId?: string
  }
  autoTuningEnabled: boolean
  updateThread: (id: string, updates: Partial<Thread>) => void
  activeTeam: AgentTeam
  activeTeamId: string | undefined
  activeTeamSnapshot: unknown
  agentTeams: AgentTeam[]
  handleTeamChange: (teamId: string | undefined) => void
  teamTokensUsed: number
  costApprovalState: CostApprovalState
  setCostApprovalState: (state: CostApprovalState) => void
  showVariablePrompt: boolean
  setShowVariablePrompt: (show: boolean) => void
  handleVariableSubmit: (values: Record<string, string>) => void
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
  handleContextSizeIncrease,
  reasoningContainerRef,
  pinnedArtifact,
  clearArtifact,
  pinnedResearch,
  clearResearch,
  splitPaneOrder,
  splitThreadId,
  setSplitThreadId,
  setSplitDirection,
  handleSplit,
  showThreadPromptEditor,
  setShowThreadPromptEditor,
  threadPromptDraft,
  setThreadPromptDraft,
  showPromptDebug,
  setShowPromptDebug,
  promptResolution,
  optimizedModelConfig,
  autoTuningEnabled,
  updateThread,
  activeTeam,
  activeTeamId,
  activeTeamSnapshot,
  agentTeams,
  handleTeamChange,
  teamTokensUsed,
  costApprovalState,
  setCostApprovalState,
  showVariablePrompt,
  setShowVariablePrompt,
  handleVariableSubmit,
}: ThreadViewProps) {
  const navigate = useNavigate()
  const hasPanels = Boolean(pinnedArtifact || pinnedResearch)

  return (
    <div className="flex flex-col h-[calc(100dvh-(env(safe-area-inset-bottom)+env(safe-area-inset-top)))]">
      <HeaderPage>
        <div className="flex items-center w-full pr-2">
          <DropdownModelProvider model={threadModel} />
        </div>
      </HeaderPage>
      <div className="flex flex-1 flex-col h-full overflow-hidden">
        {/* ── Toolbar ── */}
        <div className="px-4 md:px-8 pb-2 shrink-0">
          <div className="mx-auto w-full md:w-4/5 xl:w-4/6 flex items-center justify-end gap-2">
            {!splitPaneOrder && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowThreadPromptEditor((v) => !v)}
                >
                  Thread Prompt
                </Button>
                <Button
                  variant={showPromptDebug ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => setShowPromptDebug((v) => !v)}
                >
                  Debug
                </Button>
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant={activeTeamId ? 'secondary' : 'outline'} size="sm">
                  {activeTeam ? activeTeam.name : 'Agent Team'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => handleTeamChange(undefined)}>
                  No Team (single agent)
                </DropdownMenuItem>
                {agentTeams.map((team: AgentTeam) => (
                  <DropdownMenuItem key={team.id} onSelect={() => handleTeamChange(team.id)}>
                    {team.name}{team.id === activeTeamId && ' ✓'}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {activeTeamId && activeTeamSnapshot && activeTeam && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={async () => {
                  await updateThread(threadId, {
                    metadata: { ...(thread?.metadata ?? {}), agent_team_snapshot: null },
                  })
                  toast.success('Team config will refresh on next run')
                }}
              >
                Update Config
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Columns2 className="size-4" /><span>Split View</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => handleSplit('left')}>Split Left</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => handleSplit('right')}>Split Right</DropdownMenuItem>
                {splitPaneOrder && (
                  <DropdownMenuItem onSelect={() => { setSplitThreadId(null); setSplitDirection(null) }}>
                    Close Split View
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {/* Team info bar */}
          {!splitPaneOrder && activeTeam && (
            <div className="mx-auto w-full md:w-4/5 xl:w-4/6 mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              <span>{activeTeam.name}</span>
              <span>&middot;</span>
              <span>{activeTeam.agent_ids.length} agent{activeTeam.agent_ids.length !== 1 ? 's' : ''}</span>
              {activeTeam.token_budget && (
                <><span>&middot;</span><span>{teamTokensUsed.toLocaleString()} / {activeTeam.token_budget.toLocaleString()} tokens</span></>
              )}
              {!activeTeam.token_budget && teamTokensUsed > 0 && (
                <><span>&middot;</span><span>{teamTokensUsed.toLocaleString()} tokens used</span></>
              )}
              {activeTeamSnapshot && (
                <><span>&middot;</span><span className="text-amber-500">Snapshot active</span></>
              )}
            </div>
          )}
          {/* Thread prompt editor */}
          {!splitPaneOrder && showThreadPromptEditor && (
            <div className="mx-auto w-full md:w-4/5 xl:w-4/6 mt-2 rounded-md border bg-card p-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                {promptResolution.source === 'thread' ? 'Using Thread Prompt'
                  : promptResolution.source === 'project' ? 'Inheriting from Project Prompt'
                  : promptResolution.source === 'global' ? 'Inheriting from Global Prompt'
                  : 'Using Fallback Prompt'}
              </p>
              <Textarea
                value={threadPromptDraft}
                onChange={(e) => setThreadPromptDraft(e.target.value)}
                className="min-h-24"
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
          {/* Debug panel */}
          {!splitPaneOrder && showPromptDebug && (
            <div className="mx-auto w-full md:w-4/5 xl:w-4/6 mt-2 rounded-md border bg-card p-3 text-xs space-y-1">
              <p><span className="font-medium">Source:</span> {promptResolution.source}</p>
              <p><span className="font-medium">Auto Tuning:</span> {autoTuningEnabled ? 'Enabled' : 'Disabled'}</p>
              <p><span className="font-medium">temperature:</span> {optimizedModelConfig.temperature ?? 'default'}</p>
              <p><span className="font-medium">top_p:</span> {optimizedModelConfig.top_p ?? 'default'}</p>
              <p><span className="font-medium">max_output_tokens:</span> {optimizedModelConfig.max_output_tokens ?? 'default'}</p>
              <pre className="bg-muted rounded p-2 whitespace-pre-wrap break-words">{promptResolution.resolvedPrompt}</pre>
            </div>
          )}
        </div>

        {/* ── Body ── */}
        {splitPaneOrder && splitThreadId ? (
          // Split view: two side-by-side panes
          <div className="grid grid-cols-2 gap-2 px-2 pb-2 h-full">
            {splitPaneOrder.map((pane) =>
              pane === 'main' ? (
                <MainThreadPane
                  key="main-pane"
                  threadId={threadId}
                  thread={thread}
                  threadLogo={threadLogo}
                  chatMessages={chatMessages}
                  status={status}
                  stop={stop}
                  threadModel={threadModel}
                  handleSubmit={handleSubmit}
                  handleRegenerate={handleRegenerate}
                  handleEditMessage={handleEditMessage}
                  handleDeleteMessage={handleDeleteMessage}
                  reasoningContainerRef={reasoningContainerRef}
                  showThreadPromptEditor={showThreadPromptEditor}
                  setShowThreadPromptEditor={setShowThreadPromptEditor}
                  threadPromptDraft={threadPromptDraft}
                  setThreadPromptDraft={setThreadPromptDraft}
                  promptResolution={promptResolution}
                  updateThread={updateThread}
                  isSplitView
                  onSplitClose={() => {
                    if (!splitThreadId) return
                    setSplitThreadId(null)
                    setSplitDirection(null)
                    navigate({ to: '/threads/$threadId', params: { threadId: splitThreadId } })
                  }}
                />
              ) : (
                <SplitThreadPane
                  key="split-pane"
                  threadId={splitThreadId}
                  onClose={() => { setSplitThreadId(null); setSplitDirection(null) }}
                />
              )
            )}
          </div>
        ) : (
          // Normal view: optional right panel
          <div className={hasPanels ? 'grid grid-cols-2 gap-2 px-2 pb-2 h-full' : 'flex flex-1 flex-col h-full overflow-hidden'}>
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
              handleContextSizeIncrease={handleContextSizeIncrease}
              reasoningContainerRef={reasoningContainerRef}
              showThreadPromptEditor={false}
              setShowThreadPromptEditor={setShowThreadPromptEditor}
              threadPromptDraft={threadPromptDraft}
              setThreadPromptDraft={setThreadPromptDraft}
              promptResolution={promptResolution}
              updateThread={updateThread}
              hasPanels={hasPanels}
            />
            {pinnedResearch && (
              <ResearchPanel threadId={threadId} onClose={() => clearResearch(threadId)} />
            )}
            {!pinnedResearch && pinnedArtifact && (
              <ArtifactPanel threadId={threadId} onClose={() => clearArtifact(threadId)} />
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {activeTeam && activeTeam.variables && activeTeam.variables.length > 0 && (
        <TeamVariablePrompt
          open={showVariablePrompt}
          onOpenChange={setShowVariablePrompt}
          teamName={activeTeam.name}
          variables={activeTeam.variables}
          onSubmit={handleVariableSubmit}
        />
      )}
      {costApprovalState && (
        <CostApprovalModal
          open={true}
          estimate={costApprovalState.estimate}
          onApprove={() => { costApprovalState.resolve(true); setCostApprovalState(null) }}
          onCancel={() => { costApprovalState.resolve(false); setCostApprovalState(null) }}
        />
      )}
    </div>
  )
}

// ─── Internal sub-component ───────────────────────────────────────────────────

type MainThreadPaneProps = {
  threadId: string
  thread: Thread | undefined
  threadLogo: string
  chatMessages: UIMessage[]
  status: string
  error?: Error | null
  stop: () => void
  threadModel: Thread['model'] | undefined
  handleSubmit: (text: string, files?: FileItem[]) => Promise<void>
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

function MainThreadPane({
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

  // Thread title — shown in split view pane header or as a standalone title
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
                <X className="size-4" />
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

      {/* Messages + Input — wrapped in a flex column only for split-view */}
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

// ─── MessagesArea ─────────────────────────────────────────────────────────────

type MessagesAreaProps = {
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

function MessagesArea({
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
