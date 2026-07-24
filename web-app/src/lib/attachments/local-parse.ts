/**
 * Local text fallback for document attachment when fabric_extract / AkiDB
 * MCP tools are unavailable. Covers plain-text document types only.
 */
import { fs } from '@ax-studio/core'
import { fileExtension } from '@/lib/utils'

/** Extensions that can be read as UTF-8 text without fabric_extract. */
export const LOCAL_TEXT_DOCUMENT_EXTENSIONS = [
  'txt',
  'md',
  'csv',
  'html',
  'htm',
] as const

export type LocalTextDocumentExtension =
  (typeof LOCAL_TEXT_DOCUMENT_EXTENSIONS)[number]

export function normalizeDocumentExtension(
  fileTypeOrPath?: string
): string {
  if (!fileTypeOrPath) return ''
  // Bare extension ("md"), dotted (".md"), filename ("notes.md"), or path.
  const trimmed = fileTypeOrPath.trim()
  if (
    !trimmed.includes('/') &&
    !trimmed.includes('\\') &&
    !trimmed.includes('.')
  ) {
    return trimmed.replace(/^\./, '').toLowerCase()
  }
  if (/^\.[a-z0-9]+$/i.test(trimmed)) {
    return trimmed.slice(1).toLowerCase()
  }
  return fileExtension(trimmed).toLowerCase()
}

export function isLocallyReadableDocument(fileTypeOrPath?: string): boolean {
  const ext = normalizeDocumentExtension(fileTypeOrPath)
  return (LOCAL_TEXT_DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)
}

export function isLocallyReadableDocumentFromHints(
  ...hints: Array<string | undefined>
): boolean {
  return hints.some((hint) => isLocallyReadableDocument(hint))
}

/**
 * Read a text-like document from disk. Returns empty string for binary types
 * or on read failure (caller decides whether to error or skip).
 */
export async function parseLocalDocumentText(
  path: string,
  fileType?: string
): Promise<string> {
  const ext = [fileType, path]
    .map((hint) => normalizeDocumentExtension(hint))
    .find((candidate) =>
      (LOCAL_TEXT_DOCUMENT_EXTENSIONS as readonly string[]).includes(candidate)
    )
  if (!ext) return ''
  try {
    const content = await fs.readFileSync(path)
    return typeof content === 'string' ? content : ''
  } catch (err) {
    console.warn('[local-parse] Failed to read document as text:', path, err)
    return ''
  }
}
