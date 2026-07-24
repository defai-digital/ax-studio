import type { MCPService } from '@/services/mcp/types'
import type { Attachment } from '@/types/attachment'
import { fabricDocumentId } from '@/lib/file-registry'
import { parseLocalDocumentText } from '@/lib/attachments/local-parse'
import { getMcpToolFailureMessage } from '@/lib/ax-bi/mcp-result'

const MAX_CHUNK_CHARS = 4_000
const CHUNK_OVERLAP_CHARS = 300

export function chunkTextForAkiV09(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []

  const chunks: string[] = []
  let cursor = 0
  while (cursor < normalized.length) {
    const hardEnd = Math.min(cursor + MAX_CHUNK_CHARS, normalized.length)
    let end = hardEnd
    if (hardEnd < normalized.length) {
      const paragraphBreak = normalized.lastIndexOf('\n\n', hardEnd)
      const lineBreak = normalized.lastIndexOf('\n', hardEnd)
      const sentenceBreak = normalized.lastIndexOf('. ', hardEnd)
      const softEnd = Math.max(paragraphBreak, lineBreak, sentenceBreak)
      if (softEnd > cursor + Math.floor(MAX_CHUNK_CHARS * 0.5)) {
        end = softEnd + (softEnd === sentenceBreak ? 1 : 0)
      }
    }

    const chunk = normalized.slice(cursor, end).trim()
    if (chunk) chunks.push(chunk)
    if (end >= normalized.length) break
    cursor = Math.max(end - CHUNK_OVERLAP_CHARS, cursor + 1)
  }

  return chunks
}

export async function indexAttachmentWithAkiV09Memory(options: {
  mcp: MCPService
  collectionId: string
  attachment: Attachment
  extractedText?: string
}): Promise<{ fileId: string; chunkCount: number; size?: number }> {
  const { mcp, collectionId, attachment, extractedText } = options
  if (!attachment.path) {
    throw new Error('AkiDB memory indexing requires a file path')
  }

  const text =
    extractedText ??
    (await parseLocalDocumentText(attachment.path, attachment.fileType))
  const chunks = chunkTextForAkiV09(text)
  if (chunks.length === 0) {
    throw new Error(
      'This file did not contain extractable text and cannot be indexed.'
    )
  }

  const fileId = fabricDocumentId(attachment.path)
  for (let index = 0; index < chunks.length; index += 1) {
    const chunkText = [
      `File: ${attachment.name}`,
      `Chunk: ${index + 1}/${chunks.length}`,
      '',
      chunks[index],
    ].join('\n')

    const result = await mcp.callTool({
      toolName: 'memory_write',
      arguments: {
        id: `${fileId}:${index}`,
        kind: 'source',
        text: chunkText,
        source_uri: attachment.path,
        workspace: collectionId,
      },
    })

    const failure = getMcpToolFailureMessage(result)
    if (failure) {
      throw new Error(`AkiDB memory_write failed: ${failure}`)
    }
  }

  return {
    fileId,
    chunkCount: chunks.length,
    size: attachment.size,
  }
}
