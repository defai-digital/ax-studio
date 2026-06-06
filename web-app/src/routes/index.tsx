import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import ChatInput from '@/features/chat/components/ChatInput'
import HeaderPage from '@/containers/HeaderPage'
import { useTools } from '@/hooks/useTools'
import { cn } from '@/lib/utils'

import { useModelProvider } from '@/features/models/hooks/useModelProvider'
import SetupScreen from '@/containers/SetupScreen'
import { route } from '@/constants/routes'
import { localStorageKey } from '@/constants/localStorage'
import { SESSION_STORAGE_KEY } from '@/constants/chat'

type SearchParams = {
  model?: {
    id: string
    provider: string
  }
}
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useThreads } from '@/features/threads/hooks/useThreads'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import { resolveSystemPrompt } from '@/lib/system-prompt'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Code2,
  PenTool,
  BarChart3,
  Lightbulb,
  Bug,
  Search,
  Zap,
  Columns2,
  Cpu,
  Bolt,
  Shield,
  Wrench,
  MessageSquareText,
  Users,
  type LucideIcon,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAgentTeamStore } from '@/features/multi-agent/stores/agent-team-store'
import { motion } from 'motion/react'

export const Route = createFileRoute(route.home)({
  component: Index,
  validateSearch: (search: Record<string, unknown>): SearchParams => {
    const result: SearchParams = {
      model: search.model as SearchParams['model'],
    }

    return result
  },
})

type SuggestedPrompt = {
  icon: LucideIcon
  label: string
  prompt: string
  tag: string
  color: string
}

const suggestedPrompts: SuggestedPrompt[] = [
  {
    icon: Code2,
    label: 'Build REST API',
    prompt: 'Help me build a REST API with authentication and CRUD endpoints',
    tag: 'Code',
    color: 'indigo',
  },
  {
    icon: PenTool,
    label: 'Write blog post',
    prompt: 'Write a blog post about the latest trends in AI technology',
    tag: 'Write',
    color: 'emerald',
  },
  {
    icon: BarChart3,
    label: 'Analyze data',
    prompt: 'Analyze this dataset and provide insights with visualizations',
    tag: 'Analyze',
    color: 'cyan',
  },
  {
    icon: Lightbulb,
    label: 'Brainstorm ideas',
    prompt: 'Brainstorm creative ideas for a new mobile app',
    tag: 'Ideate',
    color: 'amber',
  },
  {
    icon: Bug,
    label: 'Debug code',
    prompt: 'Help me debug this code and find the root cause of the issue',
    tag: 'Debug',
    color: 'rose',
  },
  {
    icon: Search,
    label: 'Research topic',
    prompt: 'Research and summarize the current state of quantum computing',
    tag: 'Research',
    color: 'violet',
  },
]

const capabilityBadges = [
  { icon: Cpu, label: 'Local models' },
  { icon: Bolt, label: 'Lightning fast' },
  { icon: Shield, label: 'Private & local' },
  { icon: Wrench, label: 'Tool use & MCP' },
]

const tagColorMap: Record<string, string> = {
  indigo: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  emerald: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  cyan: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  amber: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  rose: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  violet: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
}

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
  useTools()

  const [showThreadPromptEditor, setShowThreadPromptEditor] = useState(false)
  const [threadPromptDraft, setThreadPromptDraft] = useState(
    () => sessionStorage.getItem(SESSION_STORAGE_KEY.NEW_THREAD_PROMPT) || ''
  )

  // Agent Team selection for new threads
  const agentTeams = useAgentTeamStore((state) => state.teams)
  const agentTeamsLoaded = useAgentTeamStore((state) => state.isLoaded)
  const loadTeams = useAgentTeamStore((state) => state.loadTeams)
  const [selectedTeamId, setSelectedTeamId] = useState<string | undefined>(
    () =>
      sessionStorage.getItem(SESSION_STORAGE_KEY.NEW_THREAD_TEAM_ID) ||
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
      sessionStorage.setItem(
        SESSION_STORAGE_KEY.SPLIT_VIEW_INFO,
        JSON.stringify({ splitThreadId: splitThread.id, direction })
      )
      navigate({
        to: '/threads/$threadId',
        params: { threadId: mainThread.id },
      })
    },
    [createThread, selectedModel, activeModel?.id, selectedProvider, navigate]
  )

  // Track setup completion in React state so the component re-renders when the
  // user completes setup (navigating to the same route would not trigger a re-render).
  const [setupCompleted, setSetupCompleted] = useState(
    () => localStorage.getItem(localStorageKey.setupCompleted) === 'true'
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
      sessionStorage.setItem(SESSION_STORAGE_KEY.NEW_THREAD_PROMPT, trimmed)
    } else {
      sessionStorage.removeItem(SESSION_STORAGE_KEY.NEW_THREAD_PROMPT)
    }
  }, [threadPromptDraft])

  // Persist selected team ID to sessionStorage so the new thread picks it up
  useEffect(() => {
    if (selectedTeamId) {
      sessionStorage.setItem(
        SESSION_STORAGE_KEY.NEW_THREAD_TEAM_ID,
        selectedTeamId
      )
    } else {
      sessionStorage.removeItem(SESSION_STORAGE_KEY.NEW_THREAD_TEAM_ID)
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
              </DropdownMenuContent>
            </DropdownMenu>
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

            {/* Suggested prompts grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {suggestedPrompts.map((item, i) => {
                const Icon = item.icon
                return (
                  <motion.button
                    key={item.label}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 + i * 0.04, duration: 0.35 }}
                    onClick={() => {
                      const input =
                        document.querySelector<HTMLTextAreaElement>(
                          '[data-chat-input]'
                        )
                      if (input) {
                        const nativeInputValueSetter =
                          Object.getOwnPropertyDescriptor(
                            window.HTMLTextAreaElement.prototype,
                            'value'
                          )?.set
                        nativeInputValueSetter?.call(input, item.prompt)
                        input.dispatchEvent(
                          new Event('input', { bubbles: true })
                        )
                        input.focus()
                      }
                    }}
                    className="group text-left rounded-xl border bg-card/50 p-3.5 hover:bg-card hover:border-border/80 hover:shadow-sm transition-all cursor-pointer"
                  >
                    <div className="flex items-start gap-3">
                      <div className="shrink-0 mt-0.5">
                        <Icon className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium mb-1 group-hover:text-foreground transition-colors">
                          {item.label}
                        </div>
                        <div className="text-xs text-muted-foreground/70 line-clamp-2 mb-2">
                          {item.prompt}
                        </div>
                        <span
                          className={cn(
                            'inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full border font-medium',
                            tagColorMap[item.color] ??
                              'bg-muted text-muted-foreground'
                          )}
                        >
                          {item.tag}
                        </span>
                      </div>
                    </div>
                  </motion.button>
                )
              })}
            </div>
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
