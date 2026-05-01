import { useState, useEffect, useCallback, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export type AgentLine = {
  kind: 'line' | 'error' | 'done'
  text: string
  timestamp: number
}

export type AgentStatus = 'idle' | 'running' | 'done' | 'error'

export type AxAgent = {
  id: string
  description: string
  team: string
  enabled: boolean
}

type AgentEvent = {
  session_id: string
  kind: string
  data: string
}

export function useAgentMode(threadId: string) {
  const [isAgentMode, setIsAgentMode] = useState(false)
  const [status, setStatus] = useState<AgentStatus>('idle')
  const [lines, setLines] = useState<AgentLine[]>([])
  const [agents, setAgents] = useState<AxAgent[]>([])
  const [selectedAgent, setSelectedAgent] = useState<string>('standard')
  const [selectedProvider, setSelectedProvider] = useState<string | null>('opencode')
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [axVersion, setAxVersion] = useState<string | null>(null)
  const [axError, setAxError] = useState<string | null>(null)
  const sessionId = `agent-${threadId}`
  const unlistenRef = useRef<(() => void) | null>(null)

  // Check if ax is installed and load agent list
  useEffect(() => {
    if (!IS_TAURI) return
    invoke<string>('ax_check')
      .then((version) => {
        setAxVersion(version)
        return invoke<AxAgent[]>('ax_list_agents')
      })
      .then((list) => {
        setAgents(list)
      })
      .catch((err) => {
        setAxError(typeof err === 'string' ? err : String(err))
      })
  }, [])

  // Subscribe to ax://agent events for this session
  useEffect(() => {
    if (!IS_TAURI) return
    let cancelled = false

    listen<AgentEvent>('ax://agent', (event) => {
      const payload = event.payload
      if (payload.session_id !== sessionId) return

      const line: AgentLine = {
        kind: payload.kind as AgentLine['kind'],
        text: payload.data,
        timestamp: Date.now(),
      }

      setLines((prev) => [...prev, line])

      if (payload.kind === 'done') {
        setStatus('done')
      } else if (payload.kind === 'error' && payload.data.includes('error')) {
        setStatus('error')
      }
    }).then((unlisten) => {
      if (cancelled) { unlisten(); return }
      unlistenRef.current = unlisten
    }).catch(() => {})

    return () => {
      cancelled = true
      unlistenRef.current?.()
    }
  }, [sessionId])

  const runAgent = useCallback(async (task: string) => {
    if (!IS_TAURI) return
    if (status === 'running') return
    setLines([])
    setStatus('running')

    try {
      await invoke('ax_run_agent', {
        sessionId,
        agentId: selectedAgent,
        task,
        provider: selectedProvider ?? undefined,
        model: selectedModel ?? undefined,
      })
    } catch (err) {
      const errorText = typeof err === 'string' ? err : String(err)
      setLines([{ kind: 'error', text: errorText, timestamp: Date.now() }])
      setStatus('error')
    }
  }, [sessionId, selectedAgent, status])

  const runAgentWithConfig = useCallback(async (
    task: string,
    agentId: string,
    provider: string | null,
    model: string | null,
  ) => {
    if (!IS_TAURI) return
    if (status === 'running') return
    setLines([])
    setStatus('running')
    setSelectedAgent(agentId)
    if (provider !== null) setSelectedProvider(provider)
    if (model !== null) setSelectedModel(model)

    try {
      await invoke('ax_run_agent', {
        sessionId,
        agentId,
        task,
        provider: provider ?? undefined,
        model: model ?? undefined,
      })
    } catch (err) {
      const errorText = typeof err === 'string' ? err : String(err)
      setLines([{ kind: 'error', text: errorText, timestamp: Date.now() }])
      setStatus('error')
    }
  }, [sessionId, status])

  const stopAgent = useCallback(async () => {
    if (!IS_TAURI) return
    try {
      await invoke('ax_stop', { sessionId })
      setStatus('idle')
      setLines((prev) => [...prev, { kind: 'line', text: '— stopped by user —', timestamp: Date.now() }])
    } catch (err) {
      console.error('Failed to stop agent:', err)
    }
  }, [sessionId])

  const resetAgent = useCallback(() => {
    setStatus('idle')
    setLines([])
  }, [])

  return {
    isAgentMode,
    setIsAgentMode,
    status,
    lines,
    agents,
    selectedAgent,
    setSelectedAgent,
    selectedProvider,
    setSelectedProvider,
    selectedModel,
    setSelectedModel,
    axVersion,
    axError,
    runAgent,
    runAgentWithConfig,
    stopAgent,
    resetAgent,
    isAxInstalled: axVersion !== null,
  }
}
