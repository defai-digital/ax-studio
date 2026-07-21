import type { MCPService } from '@/services/mcp/types'
import { getMcpToolFailureMessage } from '@/lib/ax-bi/mcp-result'

type DeleteIndexedFileOptions = {
  collectionId: string
  documentId: string
  expectedChunkCount?: number
}

export async function deleteIndexedFileChunks(
  mcp: MCPService,
  {
    collectionId,
    documentId,
    expectedChunkCount,
  }: DeleteIndexedFileOptions
): Promise<void> {
  const searchResult = await mcp.callTool({
    toolName: 'fabric_search',
    arguments: {
      query: '',
      collection_id: collectionId,
      top_k: 10_000,
      mode: 'keyword',
      filters: { doc_id: documentId },
    },
  })
  const searchFailure = getMcpToolFailureMessage(searchResult)
  if (searchFailure) {
    throw new Error(`Failed to find indexed chunks: ${searchFailure}`)
  }

  const text = searchResult.content?.find((item) => item.text)?.text
  if (!text) {
    throw new Error('Failed to find indexed chunks: empty search response')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Failed to find indexed chunks: invalid search response')
  }
  const results =
    parsed &&
    typeof parsed === 'object' &&
    Array.isArray((parsed as { results?: unknown }).results)
      ? (parsed as { results: Array<Record<string, unknown>> }).results
      : []
  const chunkIds = [
    ...new Set(
      results
        .map((result) => result.chunkId ?? result.chunk_id)
        .filter(
          (chunkId): chunkId is string =>
            typeof chunkId === 'string' && chunkId.trim() !== ''
        )
    ),
  ]

  if (
    typeof expectedChunkCount === 'number' &&
    expectedChunkCount > chunkIds.length
  ) {
    throw new Error(
      `Only found ${chunkIds.length} of ${expectedChunkCount} indexed chunks`
    )
  }
  if (chunkIds.length === 0) return

  const deleteResult = await mcp.callTool({
    toolName: 'akidb_delete_chunks',
    arguments: {
      collection_id: collectionId,
      chunk_ids: chunkIds,
      reason: 'file_deleted',
    },
  })
  const deleteFailure = getMcpToolFailureMessage(deleteResult)
  if (deleteFailure) {
    throw new Error(`Failed to delete indexed chunks: ${deleteFailure}`)
  }
}
