export function truncateToTokenLimit(text: string, maxTokens: number): string {
  const DEFAULT_MAX_TOKENS = 4096
  const effectiveMax = maxTokens > 0 ? maxTokens : DEFAULT_MAX_TOKENS
  const maxChars = effectiveMax * 4
  if (text.length <= maxChars) return text

  const truncated = text.slice(0, maxChars)
  const lastSentence = truncated.lastIndexOf('.')
  const cutPoint = lastSentence > maxChars * 0.8 ? lastSentence + 1 : maxChars

  return (
    truncated.slice(0, cutPoint) +
    `\n\n[Output truncated. Original length: ${text.length} chars, limit: ${maxChars} chars]`
  )
}
