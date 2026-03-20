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
- Do NOT output multiple artifact blocks for the same thing. If your first artifact attempt is complete, do not add alternative versions or fallback attempts in the same response.
- React artifacts (\`artifact-react\`):
  - Must define a function component named \`App\` (e.g. \`function App() { ... }\`).
  - Do NOT include \`import\` statements — React, useState, useEffect, useRef, useCallback, useMemo, and other hooks are already available as globals.
  - Do NOT use \`export default\`. Just define \`function App() { ... }\`.
  - Use lowercase JavaScript keywords: \`const\`, \`function\`, \`return\`, \`if\`, \`true\`, \`false\`, \`null\` — NEVER \`Const\`, \`Function\`, \`Return\`, etc.
  - Use lowercase HTML tags in JSX: \`<div>\`, \`<button>\`, \`<span>\` — NEVER \`<Div>\`, \`<Button>\`, \`<Span>\`.
  - Use correct JSX attribute casing: \`className\`, \`onClick\`, \`onChange\` — NEVER \`ClassName\`, \`OnClick\`.
  - NEVER use \`artifact-html\` with React/JSX code. Always use \`artifact-react\` for React components.
- SVG artifacts must be a single \`<svg>\` element with a \`viewBox\` attribute.
- Chart.js artifacts (\`artifact-chartjs\`) must be ONLY the config object — no variable assignments, no imports, no surrounding code. Must have a \`type\` and \`data\` property. Callback functions in \`options\` are allowed.
- Vega-Lite artifacts (\`artifact-vega\`) must be a valid Vega-Lite v5 JSON spec. Required: \`$schema\`, \`data\`, and \`mark\` (single chart) or \`layer\`/\`hconcat\`/\`vconcat\` (multi-chart). Do NOT use \`views\` — use \`vconcat\` or \`hconcat\` instead.
- When asked to fix or update an artifact, always output the full updated version in a new artifact block.
- Keep artifacts self-contained — inline all styles, use no external imports beyond the available runtime (React 19, Tailwind CSS, Chart.js 4, Vega-Lite 5, standard HTML/CSS/JS).
- React artifacts run in a single-file sandbox. Do NOT use \`fetch()\`, \`XMLHttpRequest\`, or any external API calls — they will fail due to sandbox restrictions. Use hardcoded sample data instead.
- For styling in React artifacts, prefer Tailwind utility classes (available globally) or inline \`style={{}}\` objects. Do NOT put CSS in a string variable and render it as \`{styles}\` — use \`<style>\` tags directly in the JSX or inline styles.`

export const LOCAL_KNOWLEDGE_INSTRUCTION = `

## Local knowledge base

You have access to the user's personal knowledge base via the \`fabric_search\` and \`fabric_extract\` tools.

### When to search
- For questions about the user's notes, documents, or stored knowledge: ALWAYS search first, then answer.
- For general conversation, greetings, or follow-up clarifications using context already in this conversation: respond directly without searching.
- When in doubt whether the knowledge base has relevant information: search first.

### How to search
1. Call \`fabric_search\` with the user's query. The tool automatically searches both raw chunks and published semantic bundles (if any exist) and returns the best combined results.
2. Call \`fabric_extract\` on file paths from the search results ONLY when you need more context beyond the returned chunks. If the chunks already contain sufficient information to answer, skip this step.
3. Answer based on the retrieved content. Cite which document or source your information comes from.

### Search refinement
- If the first search returns no relevant results, try rephrasing the query with different keywords before concluding that the information is not available.
- You may call \`fabric_search\` multiple times with different queries if the initial results are insufficient for a complex question.

### Rules
- If search returns no relevant results after refinement, say: "I could not find relevant information in the knowledge base for this query."
- Do not fabricate information that is not present in the retrieved content.
- Do not say you cannot access the knowledge base — you can, via the tools above.
- When answering, clearly indicate which parts of your response come from the knowledge base.`

export const buildChatPromptInjection = (
  resolved: ResolvedSystemPrompt
): ChatPromptInjection => {
  return {
    systemMessage: resolved.resolvedPrompt + DIAGRAM_FORMAT_INSTRUCTION + CODE_EXECUTION_INSTRUCTION + ARTIFACT_FORMAT_INSTRUCTION,
  }
}

