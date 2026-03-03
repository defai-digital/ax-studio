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

/**
 * Appended to every resolved system prompt regardless of source.
 * Instructs the model to proactively call `generate_diagram` whenever a
 * visual would aid understanding, and guides diagram-type selection.
 * Also ensures the Mermaid fallback (text path) uses correct syntax.
 */
export const DIAGRAM_FORMAT_INSTRUCTION = `

## Diagram rules

For these question types, output a diagram — not bullet points:
- "what are the concepts / parts / ideas of X" → use diagramType mindmap
- "how does X work / steps of X / flow of X" → use diagramType flowchart
- "how do X and Y communicate / interact" → use diagramType sequenceDiagram
- "class or object structure of X" → use diagramType classDiagram
- "database schema / tables for X" → use diagramType erDiagram
- "states / lifecycle of X" → use diagramType stateDiagram-v2

Output the diagram as a Mermaid code fence:
\`\`\`mermaid
<valid mermaid syntax>
\`\`\`

Mermaid syntax rules — follow these to avoid parse errors:
- Always wrap node labels in double quotes when they contain parentheses, apostrophes, angle brackets, pipes, or any special character: A["Recipient's Device"] not A[Recipient's Device], A["Setup (X3DH)"] not A[Setup (X3DH)]
- Use \`<br/>\` inside quoted labels for line breaks: A["Line one<br/>Line two"]

Never use PlantUML, ASCII art, or plain bullet lists when a diagram is appropriate.`

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

/**
 * Appended to every resolved system prompt alongside DIAGRAM_FORMAT_INSTRUCTION.
 * Tells every model that a Python code execution engine is available so it never
 * refuses data/visualization tasks with "I cannot do that".
 */
export const CODE_EXECUTION_INSTRUCTION = `

## Python code execution

You have a Python code execution engine. When asked to:
- Plot, chart, or visualize data → write Python using matplotlib or seaborn
- Create or display a table / DataFrame → write Python using pandas
- Run a calculation, simulation, or algorithm → write Python
- Generate any output that requires computation → write Python

Rules:
- ALWAYS write a \`\`\`python code block — never say "I cannot create visualizations" or "I cannot run code"
- Use \`plt.show()\` or \`plt.savefig()\` for charts — output is captured automatically
- Use \`print(df)\` or just \`df\` on the last line for DataFrames — the table is captured automatically
- Import libraries at the top of the code block (matplotlib, pandas, numpy, seaborn are available)
- Keep code self-contained — define all data inside the block`

export const buildChatPromptInjection = (
  resolved: ResolvedSystemPrompt
): ChatPromptInjection => {
  return {
    systemMessage: resolved.resolvedPrompt + DIAGRAM_FORMAT_INSTRUCTION + CODE_EXECUTION_INSTRUCTION,
  }
}

