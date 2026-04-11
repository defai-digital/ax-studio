import type { DiffSegment } from './compute-diff'

/**
 * Generate a plain-language summary of what changed between two versions.
 * Rule-based — no LLM call needed for common cases.
 */
export function generateChangeSummary(segments: DiffSegment[]): string {
  let addedWords = 0
  let removedWords = 0
  let addedLines = 0
  let removedLines = 0

  for (const seg of segments) {
    if (seg.type === 'added') {
      addedWords += seg.value.split(/\s+/).filter(Boolean).length
      addedLines += seg.value.split('\n').filter(Boolean).length
    } else if (seg.type === 'removed') {
      removedWords += seg.value.split(/\s+/).filter(Boolean).length
      removedLines += seg.value.split('\n').filter(Boolean).length
    }
  }

  // No changes
  if (addedWords === 0 && removedWords === 0) {
    return 'No changes detected.'
  }

  // Pure addition
  if (removedWords === 0) {
    if (addedLines <= 2) return `Added ${addedWords} words.`
    return `Added ${addedLines} lines of new content.`
  }

  // Pure removal
  if (addedWords === 0) {
    if (removedLines <= 2) return `Removed ${removedWords} words.`
    return `Removed ${removedLines} lines of content.`
  }

  // Small wording changes
  if (addedWords <= 10 && removedWords <= 10) {
    return `Made ${Math.max(addedWords, removedWords)} small wording changes.`
  }

  // Significant rewrite
  if (addedWords > 20 && removedWords > 20) {
    return `Rewrote ${removedLines} ${removedLines === 1 ? 'section' : 'sections'} with updated content.`
  }

  // Mixed changes
  const parts: string[] = []
  if (addedWords > 0) parts.push(`added ${addedWords} words`)
  if (removedWords > 0) parts.push(`removed ${removedWords} words`)
  return parts.join(', ').replace(/^./, (c) => c.toUpperCase()) + '.'
}
