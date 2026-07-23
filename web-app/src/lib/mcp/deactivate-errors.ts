/**
 * Classify MCP deactivate/stop errors that mean the server is already stopped.
 * Used so UI can treat "not running" as success when turning a server OFF.
 */
export function isMissingRunningServerError(error: unknown): boolean {
  const message =
    typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : String(error)
  const lowerMessage = message.toLowerCase()

  return (
    lowerMessage.includes('not found') ||
    lowerMessage.includes('not connected') ||
    lowerMessage.includes('not running')
  )
}
