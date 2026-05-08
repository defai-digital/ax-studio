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
  // Base is 4096 — enough for a complete code block.
  // 1200 was too low and truncated model output mid-generation.
  let targetTokens = 4096
  if (isReasoning) {
    targetTokens = 8192
  } else if (context.promptLength >= 2000 || context.hasAttachments) {
    targetTokens = 6144
  } else if (context.promptLength >= 800) {
    targetTokens = 4096
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

/**
 * Appended to every resolved system prompt.
 * Tells every model that a Python code execution engine is available so it never
 * refuses data/visualization tasks with "I cannot do that".
 */
export const CODE_EXECUTION_INSTRUCTION = `

## Python code execution

Use Python when asked to:
- Run a calculation, simulation, or algorithm → write Python
- Process or analyse data that requires computation → write Python
- Create or display a table / DataFrame → write Python using pandas
- Generate a chart from computed data → write Python using matplotlib or seaborn

Rules:
- ALWAYS write a \`\`\`python code block when Python is the right tool — never say "I cannot run code"
- Use \`plt.show()\` for charts — figures are captured automatically
- For DataFrames always put \`df\` or \`display(df)\` as the LAST line — NEVER use \`print(df)\` (it outputs plain text, not a styled table)
- Import libraries at the top of the code block; commonly used ones are matplotlib, pandas, numpy, seaborn — if a package is missing the user will see a ModuleNotFoundError and can install it
- Keep code self-contained — define all data inside the block`

export const LOCAL_KNOWLEDGE_INSTRUCTION = `

## Local knowledge base

You have access to the user's personal knowledge base via the \`fabric_search\` tool.

### Instructions
1. When the user asks a question, call \`fabric_search\` ONCE with their query (use top_k 5, mode "vector").
2. When you receive search results, STOP calling tools. Write a complete answer based on the results.
3. Your answer MUST be a full, detailed response — not a placeholder or summary.

### Answer format
- Start with a direct answer to the user's question
- Include specific details, quotes, and facts from the search results
- Reference the source file using [1], [2] notation
- If results don't fully answer the question, share what you found and note gaps
- If no results are returned, say: "I could not find relevant information in the knowledge base."
`

/**
 * Appended when research or local knowledge is active.
 * Instructs the model to cite sources using numbered references.
 */
export const CITATION_FORMAT_INSTRUCTION = `

## Source citations

When your response draws on information from provided sources, context, or search results:

1. Use numbered references like [1], [2] etc. to cite specific claims or facts.
2. Place the citation immediately after the relevant statement.
3. Only cite sources that were actually provided to you — never fabricate citations.
4. If you are uncertain about a claim or cannot find a source for it, say so clearly rather than presenting it as fact.
5. When no external sources are available, respond based on your knowledge but do not add fake citation numbers.`

export const buildChatPromptInjection = (
  resolved: ResolvedSystemPrompt,
  options?: { enableCitations?: boolean }
): ChatPromptInjection => {
  let systemMessage = resolved.resolvedPrompt + CODE_EXECUTION_INSTRUCTION
  if (options?.enableCitations) {
    systemMessage += CITATION_FORMAT_INSTRUCTION
  }
  return { systemMessage }
}
