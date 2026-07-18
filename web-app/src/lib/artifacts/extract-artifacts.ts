/**
 * extract-artifacts.ts
 *
 * Pure detection of artifact candidates in assistant message markdown.
 * Artifacts are derived from messages at render time — nothing is persisted.
 *
 * Rules (all must hold for a fenced code block to become an artifact):
 * - the fence is closed (unclosed fences happen while streaming — skip), and
 * - the language is html/svg/mermaid (any length) OR any language with
 *   at least MIN_CODE_LINES lines (Claude-style threshold).
 *
 * A message can yield multiple artifacts; only the first
 * MAX_ARTIFACTS_PER_MESSAGE are kept.
 */

export const MIN_CODE_LINES = 15
export const MAX_ARTIFACTS_PER_MESSAGE = 5

export type ArtifactKind = 'code' | 'html' | 'svg' | 'mermaid'

export type Artifact = {
  /** Stable id: `${messageId}:${blockIndex}` where blockIndex is the index of
   * the fenced block within the message (counting non-artifact blocks too). */
  id: string
  messageId: string
  kind: ArtifactKind
  language: string
  content: string
  lineCount: number
}

const PREVIEW_LANGUAGES: Record<string, ArtifactKind> = {
  html: 'html',
  svg: 'svg',
  mermaid: 'mermaid',
}

/**
 * Remove <think>...</think> reasoning blocks. An unclosed trailing <think>
 * (still reasoning) hides everything from the tag onwards, matching how
 * MessageItem treats text before the closing tag as reasoning-only.
 */
export function stripThinkBlocks(markdown: string): string {
  const withoutClosed = markdown.replace(/<think[^>]*>[\s\S]*?<\/think>/gi, '')
  const unclosedAt = withoutClosed.search(/<think[^>]*>/i)
  return unclosedAt === -1 ? withoutClosed : withoutClosed.slice(0, unclosedAt)
}

type FencedBlock = { language: string; content: string }

// CommonMark: opening fence ≤3 leading spaces, info string without backticks.
const FENCE_OPEN = /^ {0,3}```([^`]*)$/
const FENCE_CLOSE = /^ {0,3}```\s*$/

function parseFencedBlocks(markdown: string): FencedBlock[] {
  const blocks: FencedBlock[] = []
  let inFence = false
  let language = ''
  let buffer: string[] = []

  for (const line of markdown.split('\n')) {
    if (!inFence) {
      const open = FENCE_OPEN.exec(line)
      if (open) {
        inFence = true
        language = (open[1] ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
        buffer = []
      }
    } else if (FENCE_CLOSE.test(line)) {
      blocks.push({ language, content: buffer.join('\n').replace(/\n+$/, '') })
      inFence = false
      language = ''
      buffer = []
    } else {
      buffer.push(line)
    }
  }
  // An unclosed fence at EOF (mid-stream) is intentionally dropped.

  return blocks
}

/** Extract artifact candidates from raw assistant markdown. */
export function extractArtifacts(
  messageId: string,
  markdown: string
): Artifact[] {
  const blocks = parseFencedBlocks(stripThinkBlocks(markdown))
  const artifacts: Artifact[] = []

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    if (artifacts.length >= MAX_ARTIFACTS_PER_MESSAGE) break

    const { language, content } = blocks[blockIndex]
    const previewKind = PREVIEW_LANGUAGES[language]
    const lineCount = content === '' ? 0 : content.split('\n').length

    if (!previewKind && lineCount < MIN_CODE_LINES) continue

    artifacts.push({
      id: `${messageId}:${blockIndex}`,
      messageId,
      kind: previewKind ?? 'code',
      language,
      content,
      lineCount,
    })
  }

  return artifacts
}

/**
 * Extract artifacts from a UIMessage's parts, using the same text join as
 * MessageItem's getFullTextContent() so detection is consistent everywhere.
 */
export function extractArtifactsFromTextParts(
  messageId: string,
  parts: ReadonlyArray<{ type: string; text?: unknown }>
): Artifact[] {
  const markdown = parts
    .filter(
      (part): part is { type: 'text'; text: string } =>
        part.type === 'text' && typeof part.text === 'string'
    )
    .map((part) => part.text)
    .join('\n')
  return extractArtifacts(messageId, markdown)
}
