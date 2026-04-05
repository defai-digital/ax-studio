/**
 * ThreadView — pure layout component for the ThreadDetail route.
 *
 * Renders the full page chrome: header, toolbar, chat pane, split view,
 * artifact/research side panels, and modals. No data-fetching or business
 * logic — receives everything it needs as props.
 */
import type { RefObject } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { UIMessage } from '@ai-sdk/react'
import type { ChatStatus } from 'ai'
import HeaderPage from '@/containers/HeaderPage'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
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
import { SplitThreadContainer } from '@/containers/threads/SplitThreadContainer'
import { MainThreadPane } from '@/containers/threads/MainThreadPane'
import { Columns2, MessageSquareText, Users } from 'lucide-react'
import { toast } from 'sonner'

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
  status: ChatStatus
  error: Error | null | undefined
  stop: () => void
  handleSubmit: (text: string) => Promise<void>
  handleRegenerate: (messageId?: string) => void
  handleEditMessage: (messageId: string, newText: string) => void
  handleDeleteMessage: (messageId: string) => void
  handleContextSizeIncrease: () => Promise<void>
  reasoningContainerRef: RefObject<HTMLDivElement | null>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pinnedArtifact: any
  clearArtifact: (threadId: string) => void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pinnedResearch: any
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
  promptResolution: { source: string; resolvedPrompt: string }
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
  promptResolution,
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
        <div className="flex items-center w-full pr-4">
          <DropdownModelProvider model={threadModel} />
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
            {!splitPaneOrder && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={activeTeamId ? 'secondary' : 'ghost'}
                    size="icon-sm"
                    aria-label="Agent Team"
                    title={activeTeam ? activeTeam.name : 'Agent Team'}
                  >
                    <Users className="size-4" />
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
            )}
            {activeTeamId && activeTeamSnapshot && activeTeam && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Update Team Config"
                title="Update Team Config"
                onClick={async () => {
                  await updateThread(threadId, {
                    metadata: { ...(thread?.metadata ?? {}), agent_team_snapshot: null },
                  })
                  toast.success('Team config will refresh on next run')
                }}
              >
                <span className="size-4 flex items-center justify-center text-xs font-bold text-amber-500">!</span>
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
        </div>
      </HeaderPage>
      <div className="flex flex-1 flex-col h-full overflow-hidden">
        {/* ── Panels ── */}
        <div className="px-4 md:px-8 shrink-0">
          {/* Team info bar */}
          {!splitPaneOrder && activeTeam && (
            <div className="mx-auto w-full md:w-4/5 xl:w-4/6 pb-2 flex items-center gap-2 text-xs text-muted-foreground">
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
        </div>

        {/* ── Body ── */}
        {splitPaneOrder && splitThreadId ? (
          // Split view: two side-by-side panes
          <div className="grid grid-cols-2 gap-2 px-2 pb-2 h-full">
            {splitPaneOrder.map((pane) =>
              pane === 'main' ? (
                <div key="main-pane" className="relative h-full">
                  {pinnedResearch && (
                    <div className="absolute inset-0 z-10 flex flex-col bg-background rounded-md border overflow-hidden">
                      <ResearchPanel threadId={threadId} onClose={() => clearResearch(threadId)} />
                    </div>
                  )}
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
                    showThreadPromptEditor={showThreadPromptEditor}
                    setShowThreadPromptEditor={setShowThreadPromptEditor}
                    threadPromptDraft={threadPromptDraft}
                    setThreadPromptDraft={setThreadPromptDraft}
                    promptResolution={promptResolution}
                    updateThread={updateThread}
                    agentTeams={agentTeams}
                    activeTeamId={activeTeamId}
                    activeTeam={activeTeam}
                    handleTeamChange={handleTeamChange}
                    isSplitView
                    onSplitClose={() => {
                      if (!splitThreadId) return
                      setSplitThreadId(null)
                      setSplitDirection(null)
                      navigate({ to: '/threads/$threadId', params: { threadId: splitThreadId } })
                    }}
                  />
                </div>
              ) : (
                <SplitThreadContainer
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
