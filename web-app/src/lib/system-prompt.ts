export type ApplyMode = 'new_chats_only' | 'all_chats'

export type PromptSource = 'thread' | 'project' | 'global' | 'fallback'

export interface GlobalPromptSettings {
  globalDefaultPrompt: string
  autoTuningEnabled: boolean
  applyMode: ApplyMode
}

export interface ResolvedSystemPrompt {
  resolvedPrompt: string
  source: PromptSource
}

export interface OptimizedModelConfig {
  temperature?: number
  top_p?: number
  max_output_tokens?: number
  modelId?: string
}

export interface AutoTuningContext {
  promptLength: number
  messageCount: number
  hasAttachments?: boolean
  modelCapabilities?: string[]
}

export interface ChatPromptInjection {
  systemMessage: string
}

export const fallbackDefaultPrompt = 'You are a helpful assistant.'

const normalizePrompt = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export const resolveSystemPrompt = (
  threadPrompt: unknown,
  projectPrompt: unknown,
  globalSettings: Pick<GlobalPromptSettings, 'globalDefaultPrompt'>,
  fallbackPrompt: string = fallbackDefaultPrompt
): ResolvedSystemPrompt => {
  const threadResolved = normalizePrompt(threadPrompt)
  if (threadResolved) {
    return { resolvedPrompt: threadResolved, source: 'thread' }
  }

  const projectResolved = normalizePrompt(projectPrompt)
  if (projectResolved) {
    return { resolvedPrompt: projectResolved, source: 'project' }
  }

  const globalResolved = normalizePrompt(globalSettings.globalDefaultPrompt)
  if (globalResolved) {
    return { resolvedPrompt: globalResolved, source: 'global' }
  }

  return {
    resolvedPrompt: normalizePrompt(fallbackPrompt) || fallbackDefaultPrompt,
    source: 'fallback',
  }
}

export const getOptimizedModelConfig = (
  context: AutoTuningContext,
  baseConfig: OptimizedModelConfig
): OptimizedModelConfig => {
  const optimized: OptimizedModelConfig = { ...baseConfig }
  const caps = context.modelCapabilities ?? []
  const isReasoning = caps.includes('reasoning')

  // --- temperature ---
  let targetTemp = 0.7
  if (isReasoning) {
    targetTemp = 0.3
  } else if (context.messageCount >= 20) {
    targetTemp = 0.4
  } else if (context.messageCount >= 8) {
    targetTemp = 0.5
  }

  if (optimized.temperature == null) {
    optimized.temperature = targetTemp
  } else {
    // Only clamp downward for long conversations / reasoning
    if (context.messageCount >= 8 || isReasoning) {
      optimized.temperature = Math.min(optimized.temperature, targetTemp)
    }
  }

  // --- top_p ---
  let targetTopP = 0.9
  if (isReasoning || context.messageCount >= 20) {
    targetTopP = 0.8
  } else if (context.messageCount >= 8) {
    targetTopP = 0.85
  }

  if (optimized.top_p == null) {
    optimized.top_p = targetTopP
  } else {
    if (context.messageCount >= 8 || isReasoning) {
      optimized.top_p = Math.min(optimized.top_p, targetTopP)
    }
  }

  // --- max_output_tokens ---
  let targetTokens = 1200
  if (isReasoning) {
    targetTokens = 4096
  } else if (context.promptLength >= 2000 || context.hasAttachments) {
    targetTokens = 2048
  } else if (context.promptLength >= 800) {
    targetTokens = 1800
  }

  if (optimized.max_output_tokens == null) {
    optimized.max_output_tokens = targetTokens
  } else {
    // For non-reasoning: clamp down for long prompts / attachments
    if (!isReasoning && (context.promptLength >= 800 || context.hasAttachments)) {
      optimized.max_output_tokens = Math.min(optimized.max_output_tokens, targetTokens)
    }
    // For reasoning: use the higher target if user hasn't set one lower
    if (isReasoning) {
      optimized.max_output_tokens = Math.max(optimized.max_output_tokens, targetTokens)
    }
  }

  return optimized
}

export const buildChatPromptInjection = (
  resolved: ResolvedSystemPrompt
): ChatPromptInjection => {
  return {
    systemMessage: resolved.resolvedPrompt,
  }
}

