/**
 * Map Studio assistant/model sampling settings onto ax-engine OpenAI-compatible
 * chat/completion body fields.
 *
 * Contract: docs/API-COMPATIBILITY.md in ax-engine —
 * - supports temperature, top_p, top_k, min_p, seed, stop, max_tokens /
 *   max_completion_tokens, repetition_penalty
 * - non-default frequency_penalty / presence_penalty fail closed (omit them)
 * - Studio stores `repeat_penalty`; engine expects `repetition_penalty`
 */

export type AxEngineOpenAIParams = {
  temperature?: number
  top_p?: number
  top_k?: number
  min_p?: number
  seed?: number
  stop?: unknown
  max_tokens?: number
  max_completion_tokens?: number
  repetition_penalty?: number
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

/**
 * Pure mapping from Studio parameter bag → ax-engine request body fields.
 * Never includes frequency_penalty or presence_penalty.
 */
export function toAxEngineOpenAIParams(
  parameters: Record<string, unknown>
): AxEngineOpenAIParams {
  const result: AxEngineOpenAIParams = {}

  const temperature = asFiniteNumber(parameters.temperature)
  if (temperature != null) result.temperature = temperature

  const topP = asFiniteNumber(parameters.top_p)
  if (topP != null) result.top_p = topP

  const topK = asFiniteNumber(parameters.top_k)
  if (topK != null) result.top_k = topK

  const minP = asFiniteNumber(parameters.min_p)
  if (minP != null) result.min_p = minP

  const seed = asFiniteNumber(parameters.seed)
  if (seed != null) result.seed = seed

  // Studio name → engine name
  const repetition =
    asFiniteNumber(parameters.repetition_penalty) ??
    asFiniteNumber(parameters.repeat_penalty)
  if (repetition != null) result.repetition_penalty = repetition

  const maxTokens =
    asFiniteNumber(parameters.max_completion_tokens) ??
    asFiniteNumber(parameters.max_tokens) ??
    asFiniteNumber(parameters.max_output_tokens)
  if (maxTokens != null) {
    // Engine accepts both; prefer max_completion_tokens, keep max_tokens for
    // older clients and OpenAI-compatible SDKs that only send max_tokens.
    result.max_tokens = maxTokens
    result.max_completion_tokens = maxTokens
  }

  if (parameters.stop != null) result.stop = parameters.stop
  else if (parameters.stop_sequences != null)
    result.stop = parameters.stop_sequences

  return result
}
