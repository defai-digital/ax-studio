import { diffWords, diffLines } from 'diff'

export interface DiffSegment {
  type: 'added' | 'removed' | 'unchanged'
  value: string
}

/**
 * Compute word-level diff between two strings.
 * Best for short-to-medium text (sentences, paragraphs).
 */
export function computeWordDiff(oldText: string, newText: string): DiffSegment[] {
  const changes = diffWords(oldText, newText)
  return changes.map((change) => ({
    type: change.added ? 'added' : change.removed ? 'removed' : 'unchanged',
    value: change.value,
  }))
}

/**
 * Compute line-level diff between two strings.
 * Best for longer content (documents, multi-paragraph text).
 */
export function computeLineDiff(oldText: string, newText: string): DiffSegment[] {
  const changes = diffLines(oldText, newText)
  return changes.map((change) => ({
    type: change.added ? 'added' : change.removed ? 'removed' : 'unchanged',
    value: change.value,
  }))
}

/**
 * Choose the right diff algorithm based on content length.
 */
export function computeDiff(oldText: string, newText: string): DiffSegment[] {
  const lineCount = Math.max(oldText.split('\n').length, newText.split('\n').length)
  return lineCount > 10 ? computeLineDiff(oldText, newText) : computeWordDiff(oldText, newText)
}
