/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import ChatInput from '@/containers/ChatInput'
import HeaderPage from '@/containers/HeaderPage'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { useTools } from '@/hooks/useTools'
import { cn } from '@/lib/utils'

import { useModelProvider } from '@/hooks/useModelProvider'
import SetupScreen from '@/containers/SetupScreen'
import { route } from '@/constants/routes'
import { localStorageKey } from '@/constants/localStorage'
import { SESSION_STORAGE_KEY } from '@/constants/chat'

type SearchParams = {
  'model'?: {
    id: string
    provider: string
  }
}
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useThreads } from '@/hooks/useThreads'
import DropdownModelProvider from '@/containers/DropdownModelProvider'
import { useGeneralSetting } from '@/hooks/useGeneralSetting'
import {
  resolveSystemPrompt,
  getOptimizedModelConfig,
} from '@/lib/system-prompt'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Columns2 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAgentTeamStore } from '@/stores/agent-team-store'

export const Route = createFileRoute(route.home as any)({
  component: Index,
  validateSearch: (search: Record<string, unknown>): SearchParams => {
    const result: SearchParams = {
      model: search.model as SearchParams['model'],
    }

    return result
  },
})

function Index() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { providers, selectedModel: activeModel, selectedProvider } = useModelProvider()
  const search = useSearch({ from: route.home as any })
  const selectedModel = search.model
  const { setCurrentThreadId, createThread } = useThreads()
  const { globalDefaultPrompt, autoTuningEnabled } = useGeneralSetting()
  useTools()

  const [showThreadPromptEditor, setShowThreadPromptEditor] = useState(false)
  const [showPromptDebug, setShowPromptDebug] = useState(false)
  const [threadPromptDraft, setThreadPromptDraft] = useState(
    () => sessionStorage.getItem(SESSION_STORAGE_KEY.NEW_THREAD_PROMPT) || ''
  )

  // Agent Team selection for new threads
  const agentTeams = useAgentTeamStore((state) => state.teams)
  const agentTeamsLoaded = useAgentTeamStore((state) => state.isLoaded)
  const loadTeams = useAgentTeamStore((state) => state.loadTeams)
  const [selectedTeamId, setSelectedTeamId] = useState<string | undefined>(
    () => sessionStorage.getItem(SESSION_STORAGE_KEY.NEW_THREAD_TEAM_ID) || undefined
  )
  const selectedTeam = agentTeams.find((t) => t.id === selectedTeamId)

  useEffect(() => {
    if (!agentTeamsLoaded) {
      loadTeams()
    }
  }, [agentTeamsLoaded, loadTeams])

  const promptResolution = useMemo(
    () =>
      resolveSystemPrompt(
        threadPromptDraft.trim() || null,
        null,
        { globalDefaultPrompt }
      ),
    [globalDefaultPrompt, threadPromptDraft]
  )

  const optimizedModelConfig = useMemo(() => {
    const modelId = selectedModel?.id ?? activeModel?.id
    const baseConfig = {
      temperature: undefined as number | undefined,
      top_p: undefined as number | undefined,
      max_output_tokens: undefined as number | undefined,
      modelId,
    }
    if (!autoTuningEnabled) return baseConfig
    return getOptimizedModelConfig(
      {
        promptLength: promptResolution.resolvedPrompt.length,
        messageCount: 0,
        hasAttachments: false,
        modelCapabilities: activeModel?.capabilities,
      },
      baseConfig
    )
  }, [autoTuningEnabled, promptResolution.resolvedPrompt.length, selectedModel?.id, activeModel?.id, activeModel?.capabilities])

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
      sessionStorage.setItem(SESSION_STORAGE_KEY.NEW_THREAD_TEAM_ID, selectedTeamId)
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
        <div className="flex items-center gap-2 w-full">
          <DropdownModelProvider model={selectedModel} />
        </div>
      </HeaderPage>
      <div className="flex flex-1 flex-col min-h-0">
        {/* Scrollable content area */}
        <div
          className={cn(
            'flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col justify-center px-3 py-2'
          )}
        >
          <div
            className={cn(
              'mx-auto w-full md:w-4/5 xl:w-4/6 min-w-0',
            )}
          >
            {/* Heading */}
            <div className="text-center mb-3 sm:mb-4">
              <h1 className="text-xl sm:text-2xl mt-1 sm:mt-2 font-studio font-medium">
                {t('chat:description')}
              </h1>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 mb-3">
              <Button
                variant={showThreadPromptEditor ? 'secondary' : 'outline'}
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={selectedTeamId ? 'secondary' : 'outline'}
                    size="sm"
                  >
                    {selectedTeam ? selectedTeam.name : 'Agent Team'}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center">
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
                  <Button variant="outline" size="sm">
                    <Columns2 className="size-4" />
                    <span>Split View</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center">
                  <DropdownMenuItem onSelect={() => handleSplit('left')}>
                    Split Left
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleSplit('right')}>
                    Split Right
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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

            {/* Debug panel */}
            {showPromptDebug && (
              <div className="mb-2 rounded-md border bg-card p-2 sm:p-3 text-xs space-y-1">
                <p>
                  <span className="font-medium">Source:</span> {promptResolution.source}
                </p>
                <p>
                  <span className="font-medium">Auto Tuning:</span>{' '}
                  {autoTuningEnabled ? 'Enabled' : 'Disabled'}
                </p>
                <p>
                  <span className="font-medium">temperature:</span>{' '}
                  {optimizedModelConfig.temperature ?? 'default'}
                </p>
                <p>
                  <span className="font-medium">top_p:</span>{' '}
                  {optimizedModelConfig.top_p ?? 'default'}
                </p>
                <p>
                  <span className="font-medium">max_output_tokens:</span>{' '}
                  {optimizedModelConfig.max_output_tokens ?? 'default'}
                </p>
                <pre className="bg-muted rounded p-2 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                  {promptResolution.resolvedPrompt}
                </pre>
              </div>
            )}
          </div>
        </div>
        {/* ChatInput pinned at bottom */}
        <div className="shrink-0 px-3 pb-2 sm:pb-4">
          <div className="mx-auto w-full md:w-4/5 xl:w-4/6">
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
