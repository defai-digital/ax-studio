import type { ArtifactKind } from '@/lib/artifacts/extract-artifacts'

export const REVISE_CONTEXT_LIMIT = 4000
export const REVISE_CONTEXT_WINDOW = 500

/** Build the composer prefill for a targeted artifact revision. */
export function buildRevisePrompt({
  kind,
  content,
  selection,
  instruction,
}: {
  kind: ArtifactKind
  content: string
  selection: string
  instruction: string
}): string {
  let artifactBody = content
  if (content.length > REVISE_CONTEXT_LIMIT) {
    const at = content.indexOf(selection)
    if (at !== -1) {
      const start = Math.max(0, at - REVISE_CONTEXT_WINDOW)
      const end = Math.min(
        content.length,
        at + selection.length + REVISE_CONTEXT_WINDOW
      )
      artifactBody = `${start > 0 ? '…\n' : ''}${content.slice(start, end)}${
        end < content.length ? '\n…' : ''
      }`
    }
  }

  return `Regarding this ${kind} artifact:\n\n<artifact>\n${artifactBody}\n</artifact>\n\nFor this part:\n<selection>\n${selection}\n</selection>\n\n${instruction}`
}
