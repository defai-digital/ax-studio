import type { UIMessage } from '@ai-sdk/react'
import type { RunLogData } from '@/lib/multi-agent/run-log'

export type AgentStatusData = {
  agent_id: string
  agent_name: string
  agent_role?: string
  status: 'running' | 'complete' | 'error'
  tokens_used: number
  tool_calls?: Array<{ name: string; args: unknown }>
  error?: string
}

export type AgentToolCallData = {
  agent_id: string
  tool_name: string
  args: unknown
  result?: string
  status: 'calling' | 'complete' | 'error'
}

export type AgentDataParts = {
  agentStatus: AgentStatusData
  agentToolCall: AgentToolCallData
  runLog: RunLogData
}

export type AgentUIMessage = UIMessage<never, AgentDataParts>
