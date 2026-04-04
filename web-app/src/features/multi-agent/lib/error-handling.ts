export function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('rate limit') || msg.includes('429')) return true
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status: number }).status === 429
  ) {
    return true
  }
  return false
}

export function isTimeoutError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('timeout') || msg.includes('timed out')) return true
    if (error.name === 'AbortError' && msg.includes('timeout')) return true
  }
  return false
}

export function isToolNotSupportedError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    return (
      msg.includes('does not support tool') ||
      msg.includes('tool use is not supported') ||
      msg.includes('tools are not supported')
    )
  }
  return false
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return true
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: string }).name === 'AbortError'
  ) {
    return true
  }
  return false
}

export function handleSubAgentError(
  agent: { name: string; model_override_id?: string; timeout?: { total_ms?: number } },
  error: unknown
): { error: string } {
  if (isRateLimitError(error)) {
    return {
      error: `<agent_error name="${agent.name}" type="rate_limit">Rate limited. This agent could not complete its task. Proceed without this agent's input or note the limitation in the final response.</agent_error>`,
    }
  }

  // Check timeout BEFORE abort — AbortSignal.timeout() produces an AbortError
  // with a timeout message, and we want to handle that gracefully rather than re-throw.
  if (isTimeoutError(error)) {
    return {
      error: `<agent_error name="${agent.name}" type="timeout">Agent timed out after ${agent.timeout?.total_ms ?? 120000}ms. The task may be too complex for the step/time limits.</agent_error>`,
    }
  }

  if (isAbortError(error)) {
    throw error
  }

  if (isToolNotSupportedError(error)) {
    return {
      error: `<agent_error name="${agent.name}" type="tool_unsupported">The model "${agent.model_override_id ?? 'default'}" does not support tool calling. This agent requires a model with tool support.</agent_error>`,
    }
  }

  return {
    error: `<agent_error name="${agent.name}" type="unknown">Agent encountered an error: ${error instanceof Error ? error.message : String(error)}</agent_error>`,
  }
}
