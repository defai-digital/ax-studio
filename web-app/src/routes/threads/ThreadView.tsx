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
import { SplitThreadPane } from './SplitThreadPane'
import { MainThreadPane } from './MainThreadPane'
import { Columns2 } from 'lucide-react'
import { toast } from 'sonner'

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

