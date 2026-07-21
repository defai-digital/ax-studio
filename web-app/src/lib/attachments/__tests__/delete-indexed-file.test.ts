import { describe, expect, it, vi } from 'vitest'
import { deleteIndexedFileChunks } from '../delete-indexed-file'
import type { MCPService } from '@/services/mcp/types'

function mcpWithCallTool(callTool: ReturnType<typeof vi.fn>): MCPService {
  return { callTool } as unknown as MCPService
}

describe('deleteIndexedFileChunks', () => {
  it('deletes all chunks returned for the fabric document id', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({
        content: [
          {
            text: JSON.stringify({
              results: [{ chunkId: 'c1' }, { chunk_id: 'c2' }],
            }),
          },
        ],
      })
      .mockResolvedValueOnce({ content: [{ text: 'Deleted 2 chunks' }] })

    await deleteIndexedFileChunks(mcpWithCallTool(callTool), {
      collectionId: 'project_1',
      documentId: 'doc-id',
      expectedChunkCount: 2,
    })

    expect(callTool).toHaveBeenLastCalledWith({
      toolName: 'akidb_delete_chunks',
      arguments: {
        collection_id: 'project_1',
        chunk_ids: ['c1', 'c2'],
        reason: 'file_deleted',
      },
    })
  })

  it('refuses to remove tracking when search returns fewer chunks than expected', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [{ text: JSON.stringify({ results: [{ chunkId: 'c1' }] }) }],
    })

    await expect(
      deleteIndexedFileChunks(mcpWithCallTool(callTool), {
        collectionId: 'project_1',
        documentId: 'doc-id',
        expectedChunkCount: 2,
      })
    ).rejects.toThrow('Only found 1 of 2 indexed chunks')
    expect(callTool).toHaveBeenCalledTimes(1)
  })

  it('propagates MCP error results without deleting chunks', async () => {
    const callTool = vi.fn().mockResolvedValue({
      isError: true,
      content: [{ text: 'search unavailable' }],
    })

    await expect(
      deleteIndexedFileChunks(mcpWithCallTool(callTool), {
        collectionId: 'project_1',
        documentId: 'doc-id',
      })
    ).rejects.toThrow('search unavailable')
    expect(callTool).toHaveBeenCalledTimes(1)
  })
})
