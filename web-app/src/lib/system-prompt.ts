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
 * Instructs the model to only produce Mermaid diagrams when explicitly
 * requested by the user, and provides syntax guidelines.
 */
export const DIAGRAM_FORMAT_INSTRUCTION = `

## Diagram rules

NEVER include diagrams, flowcharts, or mermaid code blocks unless the user explicitly asks for one (e.g. "draw a diagram", "show me a flowchart", "visualize this"). By default, always respond with text only.

When a diagram IS explicitly requested, use a mermaid code fence:
\`\`\`mermaid
<valid mermaid syntax>
\`\`\`

Mermaid syntax rules (only when generating a requested diagram):
- Wrap node labels in double quotes when they contain special characters: A["Label (with parens)"]
- classDiagram: use \`List~Task~\` not \`List<Task>\`, no \`enum {A, B}\` in class body
- erDiagram: quote SQL reserved words: \`"ORDER"\` not \`ORDER\`; NEVER add \`class\`, \`classDef\`, or \`style\` blocks — only entity definitions and relationship lines are valid in erDiagram
- sequenceDiagram: every message on a single line
- stateDiagram: always use \`stateDiagram-v2\`; use ONLY flat transition lines (e.g. \`A --> B\`); NEVER use composite state blocks (\`state X { ... }\`) — they cause "would create a cycle" parse errors
- gantt: every task needs format \`Task Name :status, YYYY-MM-DD, duration\`
- mindmap: node labels must be plain text only — NEVER use \`()\`, \`[]\`, or \`{{}}\` inside node label text (they are shape-syntax tokens); write abbreviations without parentheses e.g. "CNN" not "CNN (Convolutional)"`

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
  // Base is 4096 — enough for a complete artifact or code block.
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
 * Appended to every resolved system prompt alongside DIAGRAM_FORMAT_INSTRUCTION.
 * Tells every model that a Python code execution engine is available so it never
 * refuses data/visualization tasks with "I cannot do that".
 */
export const CODE_EXECUTION_INSTRUCTION = `

## Python code execution

Tool priority — always pick the best tool in this order:
1. **Mermaid diagram** — for Gantt charts, flowcharts, ER diagrams, sequence diagrams, mind maps, etc. (see Diagram rules above)
2. **Artifact** (\`artifact-chartjs\` or \`artifact-vega\`) — for interactive bar, line, pie, scatter, or other charts that do not need computation
3. **Python** — only when actual computation is required: statistical analysis, data processing, machine learning, simulations, or generating a chart from real computed data

Use Python when asked to:
- Run a calculation, simulation, or algorithm → write Python
- Process or analyse data that requires computation → write Python
- Create or display a table / DataFrame → write Python using pandas
- Generate a chart that genuinely requires computed data (not just static sample data) → write Python using matplotlib or seaborn

Rules:
- NEVER use Python just to draw a static chart — use Mermaid or an artifact instead
- ALWAYS write a \`\`\`python code block when Python is the right tool — never say "I cannot run code"
- Use \`plt.show()\` for charts — figures are captured automatically
- For DataFrames always put \`df\` or \`display(df)\` as the LAST line — NEVER use \`print(df)\` (it outputs plain text, not a styled table)
- Import libraries at the top of the code block; commonly used ones are matplotlib, pandas, numpy, seaborn — if a package is missing the user will see a ModuleNotFoundError and can install it
- Keep code self-contained — define all data inside the block`

/**
 * Appended to every resolved system prompt alongside DIAGRAM_FORMAT_INSTRUCTION
 * and CODE_EXECUTION_INSTRUCTION. Instructs the model to wrap self-contained,
 * interactive outputs in artifact fences so the UI can render them in a preview pane.
 */
export const ARTIFACT_FORMAT_INSTRUCTION = `

## Artifacts

When generating a **self-contained, renderable output** that the user can interact with visually, wrap it in a fenced code block using one of these language identifiers:

| Output type         | Fence identifier      |
|---------------------|-----------------------|
| HTML page/component | \`\`\`artifact-html   |
| React component     | \`\`\`artifact-react  |
| SVG graphic         | \`\`\`artifact-svg      |
| Chart.js chart      | \`\`\`artifact-chartjs  |
| Vega-Lite chart     | \`\`\`artifact-vega     |

Rules:
- Use artifacts for complete, standalone outputs — landing pages, interactive demos, data visualizations, SVG illustrations.
- Do NOT use artifact fences for code examples, snippets, or partial code — only complete, immediately renderable output.
- React artifacts must define a function component named \`App\` (e.g. \`function App() { ... }\`).
- SVG artifacts must be a single \`<svg>\` element with a \`viewBox\` attribute.
- Chart.js artifacts (\`artifact-chartjs\`) must be a valid Chart.js v4 config object (JSON with a \`type\` and \`data\` property). Callback functions in \`options\` are allowed.
- Vega-Lite artifacts (\`artifact-vega\`) must be a valid Vega-Lite v5 JSON spec (with \`$schema\`, \`data\`, and \`mark\` or \`layer\`/\`hconcat\`/\`vconcat\`).
- When asked to fix or update an artifact, always output the full updated version in a new artifact block.
- Keep artifacts self-contained — inline all styles, use no external imports beyond the available runtime (React 18, Chart.js 4, Vega-Lite 5, standard HTML/CSS/JS).`

export const LOCAL_KNOWLEDGE_INSTRUCTION = `

## Local knowledge base

You MUST follow this exact sequence for every user message — no exceptions:

Step 1: Call \`fabric_search\` ONCE with the user's query. Do NOT call it again.
Step 2: Call \`fabric_extract\` on every file path returned by \`fabric_search\` to retrieve the full content.
Step 3: Answer using ONLY the content returned by the tools. Do not use training data.

Rules:
- Never call \`fabric_search\` more than once per message. If the first search returns no results, go straight to Step 3 and say: "I could not find relevant information in the knowledge base."
- Never skip \`fabric_extract\`. Always extract the full file content after searching.
- Never say you cannot access the knowledge base.`

export const buildChatPromptInjection = (
  resolved: ResolvedSystemPrompt
): ChatPromptInjection => {
  return {
    systemMessage: resolved.resolvedPrompt + DIAGRAM_FORMAT_INSTRUCTION + CODE_EXECUTION_INSTRUCTION + ARTIFACT_FORMAT_INSTRUCTION,
  }
}

