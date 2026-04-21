import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import ChatInput from '@/containers/ChatInput'
import HeaderPage from '@/containers/HeaderPage'
import { useTools } from '@/hooks/tools/useTools'
import { cn } from '@/lib/utils'
import {
  safeStorageGetItem,
  safeStorageRemoveItem,
  safeStorageSetItem,
} from '@/lib/storage'

import { useModelProvider } from '@/hooks/models/useModelProvider'
import SetupScreen from '@/containers/SetupScreen'
import { route } from '@/constants/routes'
import { localStorageKey } from '@/constants/localStorage'
import { SESSION_STORAGE_KEY } from '@/constants/chat'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { z } from 'zod/v4'

type SearchParams = {
  model?: {
    id: string
    provider: string
  }
}

const homeSearchSchema = z.object({
  model: z
    .object({
      id: z.string(),
      provider: z.string(),
    })
    .optional(),
})
import { useThreads } from '@/hooks/threads/useThreads'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
import { useGeneralSetting } from '@/hooks/settings/useGeneralSetting'
import { resolveSystemPrompt } from '@/lib/system-prompt'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Zap,
  Columns2,
  ChevronDown,
  Cpu,
  Bolt,
  Shield,
  Wrench,
  MessageSquareText,
  Users,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAgentTeamStore } from '@/stores/agent-team-store'
import { usePrompt } from '@/hooks/ui/usePrompt'
import { motion } from 'motion/react'
import { WorkflowSelector } from '@/components/smart-start/WorkflowSelector'
import { toast } from 'sonner'

export const Route = createFileRoute(route.home)({
  component: Index,
  validateSearch: (search: Record<string, unknown>): SearchParams =>
    homeSearchSchema.parse(search),
})

const capabilityBadges = [
  { icon: Cpu, label: 'Local models' },
  { icon: Bolt, label: 'Lightning fast' },
  { icon: Shield, label: 'Private & local' },
  { icon: Wrench, label: 'Tool use & MCP' },
]

function Index() {
  const navigate = useNavigate()
  const {
    providers,
    selectedModel: activeModel,
    selectedProvider,
  } = useModelProvider()
  const search = useSearch({ from: route.home })
  const selectedModel = search.model
  const { setCurrentThreadId, createThread } = useThreads()
  const { globalDefaultPrompt } = useGeneralSetting()
  const setGlobalPrompt = usePrompt((state) => state.setPrompt)
  useTools()

  const [showThreadPromptEditor, setShowThreadPromptEditor] = useState(false)
  const [threadPromptDraft, setThreadPromptDraft] = useState(
    () =>
      safeStorageGetItem(
        sessionStorage,
        SESSION_STORAGE_KEY.NEW_THREAD_PROMPT,
        'routes/index'
      ) || ''
  )

  // Agent Team selection for new threads
  const agentTeams = useAgentTeamStore((state) => state.teams)
  const agentTeamsLoaded = useAgentTeamStore((state) => state.isLoaded)
  const loadTeams = useAgentTeamStore((state) => state.loadTeams)
  const [selectedTeamId, setSelectedTeamId] = useState<string | undefined>(
    () =>
      safeStorageGetItem(
        sessionStorage,
        SESSION_STORAGE_KEY.NEW_THREAD_TEAM_ID,
        'routes/index'
      ) ||
      undefined
  )
  const selectedTeam = agentTeams.find((t) => t.id === selectedTeamId)

  useEffect(() => {
    if (!agentTeamsLoaded) {
      loadTeams()
    }
  }, [agentTeamsLoaded, loadTeams])

  const promptResolution = useMemo(
    () =>
      resolveSystemPrompt(threadPromptDraft.trim() || null, null, {
        globalDefaultPrompt,
      }),
    [globalDefaultPrompt, threadPromptDraft]
  )

  const handleSplit = useCallback(
    async (direction: 'left' | 'right') => {
      try {
        const modelConfig = {
          id: selectedModel?.id ?? activeModel?.id ?? '*',
          provider: selectedModel?.provider ?? selectedProvider,
        }
        // Create both a main thread and a split thread
        const [mainThread, splitThread] = await Promise.all([
          createThread(modelConfig, 'New Thread'),
          createThread(modelConfig, 'New Thread'),
        ])
        // Store split info so $threadId picks it up on mount
        const stored = safeStorageSetItem(
          sessionStorage,
          SESSION_STORAGE_KEY.SPLIT_VIEW_INFO,
          JSON.stringify({ splitThreadId: splitThread.id, direction }),
          'routes/index'
        )
        if (!stored) {
          throw new Error('Unable to persist split view state')
        }
        navigate({
          to: '/threads/$threadId',
          params: { threadId: mainThread.id },
        })
      } catch (error) {
        console.error('Failed to create split view:', error)
        toast.error('Failed to create split view', {
          description:
            error instanceof Error ? error.message : 'Please try again.',
        })
      }
    },
    [createThread, selectedModel, activeModel?.id, selectedProvider, navigate]
  )

  // Track setup completion in React state so the component re-renders when the
  // user completes setup (navigating to the same route would not trigger a re-render).
  const [setupCompleted, setSetupCompleted] = useState(
    () =>
      safeStorageGetItem(
        localStorage,
        localStorageKey.setupCompleted,
        'routes/index'
      ) === 'true'
  )

  const hasValidProviders =
    setupCompleted ||
    providers.some((provider) => Boolean(provider.api_key?.length))

  useEffect(() => {
    setCurrentThreadId(undefined)
  }, [setCurrentThreadId])

  // Persist thread prompt draft to sessionStorage so it survives navigation to new thread
  useEffect(() => {
    const trimmed = threadPromptDraft.trim()
    if (trimmed) {
      safeStorageSetItem(
        sessionStorage,
        SESSION_STORAGE_KEY.NEW_THREAD_PROMPT,
        trimmed,
        'routes/index'
      )
    } else {
      safeStorageRemoveItem(
        sessionStorage,
        SESSION_STORAGE_KEY.NEW_THREAD_PROMPT,
        'routes/index'
      )
    }
  }, [threadPromptDraft])

  // Persist selected team ID to sessionStorage so the new thread picks it up
  useEffect(() => {
    if (selectedTeamId) {
      safeStorageSetItem(
        sessionStorage,
        SESSION_STORAGE_KEY.NEW_THREAD_TEAM_ID,
        selectedTeamId,
        'routes/index'
      )
    } else {
      safeStorageRemoveItem(
        sessionStorage,
        SESSION_STORAGE_KEY.NEW_THREAD_TEAM_ID,
        'routes/index'
      )
    }
  }, [selectedTeamId])

  if (!hasValidProviders) {
    return <SetupScreen onComplete={() => setSetupCompleted(true)} />
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <HeaderPage>
        <div className="flex items-center w-full pr-4">
          <DropdownModelProvider model={selectedModel} useLastUsedModel />
          <div className="flex items-center gap-1 ml-auto shrink-0">
            <Button
              variant={showThreadPromptEditor ? 'secondary' : 'ghost'}
              size="icon-sm"
              aria-label="Thread Prompt"
              title="Thread Prompt"
              onClick={() => setShowThreadPromptEditor((v) => !v)}
            >
              <MessageSquareText className="size-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={selectedTeamId ? 'secondary' : 'ghost'}
                  size="icon-sm"
                  aria-label="Agent Team"
                  title={selectedTeam ? selectedTeam.name : 'Agent Team'}
                >
                  <Users className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setSelectedTeamId(undefined)}>
                  No Team (single agent)
                </DropdownMenuItem>
                {agentTeams.map((team) => (
                  <DropdownMenuItem
                    key={team.id}
                    onSelect={() => setSelectedTeamId(team.id)}
                  >
                    {team.name}
                    {team.id === selectedTeamId && ' ✓'}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Split View"
                title="Split View"
                onClick={() => void handleSplit('right')}
              >
                <Columns2 className="size-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="w-4 px-0" aria-label="Split direction">
                    <ChevronDown className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => void handleSplit('left')}>
                    Split Left
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void handleSplit('right')}>
                    Split Right
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </HeaderPage>
      <div className="flex flex-1 flex-col min-h-0 relative overflow-hidden">
        {/* Background radial gradient */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div
            className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] opacity-[0.06] dark:opacity-[0.04]"
            style={{
              background:
                'radial-gradient(ellipse, #6366f1 0%, transparent 70%)',
            }}
          />
        </div>

        {/* Scrollable content area */}
        <div
          className={cn(
            'flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col justify-center px-3 py-2 relative z-10'
          )}
        >
          <div className={cn('mx-auto w-full max-w-2xl min-w-0')}>
            {/* Hero section */}
            <div className="text-center mb-6">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                className="mx-auto mb-4 size-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20"
              >
                <Zap className="size-7 text-white" strokeWidth={2} />
              </motion.div>
              <motion.h1
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05, duration: 0.4 }}
                className="text-2xl sm:text-[30px] font-bold leading-tight"
              >
                What can I help you with?
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.4 }}
                className="text-muted-foreground text-sm mt-2"
              >
                Ask anything, build with AI, or explore what&apos;s possible.
              </motion.p>
            </div>

            {/* Thread prompt editor */}
            {showThreadPromptEditor && (
              <div className="mb-2 rounded-md border bg-card p-2 sm:p-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  {threadPromptDraft.trim()
                    ? 'Thread Prompt (will apply to new thread)'
                    : promptResolution.source === 'global'
                      ? 'Inheriting from Global Prompt'
                      : 'Using Fallback Prompt'}
                </p>
                <Textarea
                  value={threadPromptDraft}
                  onChange={(e) => setThreadPromptDraft(e.target.value)}
                  className="min-h-20 sm:min-h-24"
                  placeholder="Set a prompt for the new thread. Leave empty to inherit from global."
                />
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setThreadPromptDraft('')}
                  >
                    Clear
                  </Button>
                </div>
              </div>
            )}

            {/* Capability badges */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.5 }}
              className="flex flex-wrap items-center justify-center gap-3 mb-6"
            >
              {capabilityBadges.map((badge) => {
                const Icon = badge.icon
                return (
                  <div
                    key={badge.label}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <Icon className="size-3.5" />
                    <span>{badge.label}</span>
                  </div>
                )
              })}
            </motion.div>

            {/* Smart Start workflow selector */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.35 }}
            >
              <WorkflowSelector
                onPromptReady={(prompt) => {
                  setGlobalPrompt(prompt)
                  const input =
                    document.querySelector<HTMLTextAreaElement>(
                      '[data-chat-input]'
                    )
                  input?.focus()
                }}
              />
            </motion.div>
          </div>
        </div>
        {/* ChatInput pinned at bottom */}
        <div className="shrink-0 px-3 pb-2 sm:pb-4">
          <div className="mx-auto w-full max-w-2xl">
            <ChatInput
              showSpeedToken={false}
              model={selectedModel}
              initialMessage={true}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
