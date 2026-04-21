import { Experimental_Agent as Agent, stepCountIs } from 'ai'
import type { LanguageModel, Tool } from 'ai'
import { resolveToolsForAgent } from './delegation-tools'
import { extractAgentText } from './extract-agent-text'
import type { AgentHealthMonitor } from './agent-health-monitor'
import type { TokenUsageTracker } from './token-usage-tracker'
import type { RunLog } from './run-log'
import type { Assistant } from '@/types/threads'

export interface RunAgentOptions {
  agent: Assistant
  prompt: string
  model: LanguageModel
  createModel: (id: string, params: Record<string, unknown>) => Promise<LanguageModel>
  allTools: Record<string, Tool>
  abortSignal: AbortSignal | undefined
  tokenTracker: TokenUsageTracker
  runLog: RunLog
  healthMonitor: AgentHealthMonitor
}

export interface RunAgentResult {
  text: string
  tokens: number
  toolCalls: Array<{ name: string; args: unknown }>
}

export async function runSubAgent(options: RunAgentOptions): Promise<RunAgentResult> {
  const { agent, prompt, abortSignal } = options

  const subAgentModel = agent.model_override_id
    ? await options.createModel(agent.model_override_id, agent.parameters ?? {})
    : options.model

  const agentTools = resolveToolsForAgent(agent, options.allTools)

  let agentAbortSignal = abortSignal
  if (agent.timeout?.total_ms) {
    const timeoutSignal = AbortSignal.timeout(agent.timeout.total_ms)
    agentAbortSignal = abortSignal
      ? AbortSignal.any([abortSignal, timeoutSignal])
      : timeoutSignal
  }

  const subAgent = new Agent({
    model: subAgentModel,
    system: agent.instructions,
    tools: agentTools,
    stopWhen: stepCountIs(agent.max_steps ?? 10),
  })

  const result = await subAgent.generate({
    prompt,
    abortSignal: agentAbortSignal,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)

  const agentTokens = result.usage?.totalTokens ?? 0
  options.tokenTracker.add(agentTokens)
  options.runLog.addAgentStep(agent, result, agentTokens)
  options.healthMonitor.recordSuccess(agent.id)

  const toolCallLog = result.steps
    .flatMap((s) => s.toolCalls ?? [])
    .map((tc) => ({ name: tc.toolName, args: tc.input }))

  const agentText = extractAgentText(result)

  if (!result.text && agentText) {
    console.warn(
      `[MultiAgent] Agent "${agent.name}" had empty result.text but extractAgentText recovered ${agentText.length} chars`
    )
  }

  return {
    text: agentText,
    tokens: agentTokens,
    toolCalls: toolCallLog,
  }
}
