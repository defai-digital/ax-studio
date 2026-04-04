/**
 * Robustly extracts text from an Agent.generate() result.
 *
 * AI SDK's `result.text` only returns the FINAL step's text content
 * (parts where type === "text"). This is empty when:
 * - The model's last step was a tool call with no accompanying text
 * - The stopWhen condition fired mid-tool-use
 * - The model produced only reasoning/thinking tokens (type === "reasoning")
 * - The model returned content: null alongside tool_calls
 *
 * This function aggregates text across ALL steps and falls back to reasoning
 * text, ensuring sub-agents always return meaningful output to the orchestrator.
 */
export function extractAgentText(result: {
  text: string
  steps: Array<{
    text: string
    reasoningText?: string
    toolCalls?: Array<{ toolName: string; input: unknown }>
    toolResults?: Array<{ toolName: string; output: unknown }>
  }>
}): string {
  // 1. Primary: result.text (final step's text) — works for most models
  if (result.text) return result.text

  // 2. Aggregate text from ALL steps (handles multi-step agents where
  //    intermediate steps have text but the final step doesn't)
  const allStepText = result.steps
    .map((step) => step.text)
    .filter(Boolean)
    .join('\n')
  if (allStepText) return allStepText

  // 3. Fallback: reasoning text (thinking models may only produce reasoning)
  const allReasoning = result.steps
    .map((step) => step.reasoningText)
    .filter((t): t is string => !!t)
    .join('\n')
  if (allReasoning) return allReasoning

  // 4. Last resort: summarize tool results so the orchestrator gets something
  const toolSummaries: string[] = []
  for (const step of result.steps) {
    if (step.toolResults) {
      for (const tr of step.toolResults) {
        const outputStr =
          typeof tr.output === 'string'
            ? tr.output
            : JSON.stringify(tr.output)
        if (outputStr && outputStr.length > 0) {
          toolSummaries.push(`[${tr.toolName}]: ${outputStr}`)
        }
      }
    }
  }
  if (toolSummaries.length > 0) {
    return toolSummaries.join('\n')
  }

  console.warn(
    '[MultiAgent] extractAgentText: No text found in any step.',
    'Steps:',
    result.steps.length,
    'Final step text:',
    JSON.stringify(result.text),
  )

  return ''
}
