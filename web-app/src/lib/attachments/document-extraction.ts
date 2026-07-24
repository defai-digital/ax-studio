import type { CoreService } from '@/services/core/types'
import {
  isLocallyReadableDocumentFromHints,
  normalizeDocumentExtension,
  parseLocalDocumentText,
} from '@/lib/attachments/local-parse'

export const LOCALLY_EXTRACTABLE_BINARY_EXTENSIONS = [
  'pdf',
  'docx',
  'xlsx',
  'xls',
  'ods',
  'pptx',
] as const

export type DocumentExtractionResult = {
  text: string
  metadata: {
    format: string
    unitCount: number
    truncated: boolean
  }
  warnings: string[]
}

export function isLocallyExtractableBinaryDocument(
  ...hints: Array<string | undefined>
): boolean {
  return hints.some((hint) => {
    const extension = normalizeDocumentExtension(hint)
    return (
      LOCALLY_EXTRACTABLE_BINARY_EXTENSIONS as readonly string[]
    ).includes(extension)
  })
}

export async function extractDocumentText(options: {
  path: string
  fileType?: string
  core?: CoreService | null
}): Promise<DocumentExtractionResult> {
  const { path, fileType, core } = options
  if (isLocallyReadableDocumentFromHints(fileType, path)) {
    const text = await parseLocalDocumentText(path, fileType)
    return {
      text,
      metadata: {
        format: normalizeDocumentExtension(fileType || path),
        unitCount: text ? 1 : 0,
        truncated: false,
      },
      warnings: [],
    }
  }

  if (!core || !isLocallyExtractableBinaryDocument(fileType, path)) {
    return {
      text: '',
      metadata: {
        format: normalizeDocumentExtension(fileType || path),
        unitCount: 0,
        truncated: false,
      },
      warnings: [],
    }
  }

  const result = await core.invoke<DocumentExtractionResult>(
    'extract_document_text',
    {
      path,
      fileType: normalizeDocumentExtension(fileType || path),
    }
  )
  if (!result || typeof result.text !== 'string' || !result.metadata) {
    throw new Error('Native document extractor returned an invalid response')
  }
  if (result.warnings?.length) {
    console.warn(`[document-extraction] ${path}: ${result.warnings.join(' ')}`)
  }
  return {
    ...result,
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
  }
}
