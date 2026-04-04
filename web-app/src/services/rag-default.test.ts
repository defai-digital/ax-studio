import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DefaultRAGService } from './rag/default'
import { useFileRegistry } from '@/lib/file-registry'
import type { ServiceHub } from '@/services'

function makeServiceHub(callToolResult: {
  error: string
  content: Array<{ text: string }>
}): ServiceHub {
  return {
    mcp: () => ({
      callTool: vi.fn().mockResolvedValue(callToolResult),
    }),
  } as unknown as ServiceHub
}

describe('DefaultRAGService', () => {
  let service: DefaultRAGService

  beforeEach(() => {
    service = new DefaultRAGService()
    useFileRegistry.setState({ files: {} })
  })

  describe('getTools', () => {
    it('returns three tools', async () => {
      const tools = await service.getTools()
      expect(tools).toHaveLength(3)
      expect(tools.map((t) => t.name)).toEqual([
        'retrieve',
        'list_attachments',
        'get_chunks',
      ])
    })

    it('all tools have server set to rag-internal', async () => {
      const tools = await service.getTools()
      for (const tool of tools) {
        expect(tool.server).toBe('rag-internal')
      }
    })

    it('retrieve tool requires query', async () => {
      const tools = await service.getTools()
      const retrieve = tools.find((t) => t.name === 'retrieve')!
      const schema = retrieve.inputSchema as Record<string, unknown>
      expect(schema.required).toEqual(['query'])
    })
  })

  describe('getToolNames', () => {
    it('returns tool name array', async () => {
      const names = await service.getToolNames()
      expect(names).toEqual(['retrieve', 'list_attachments', 'get_chunks'])
    })
  })

  describe('parseDocument', () => {
    it('returns empty string when serviceHub not set', async () => {
      const result = await service.parseDocument('/tmp/doc.pdf')
      expect(result).toBe('')
    })

    it('calls fabric_extract and returns text', async () => {
      const hub = makeServiceHub({
        error: '',
        content: [
          {
            text: JSON.stringify({
              text: 'Extracted document content here',
              text_length: 30,
              truncated: false,
            }),
          },
        ],
      })
      service.setMcpService(hub.mcp())

      const result = await service.parseDocument('/tmp/doc.pdf')
      expect(result).toBe('Extracted document content here')
    })

    it('returns empty string on error', async () => {
      const hub = makeServiceHub({
        error: 'file not found',
        content: [],
      })
      service.setMcpService(hub.mcp())

      const result = await service.parseDocument('/tmp/missing.pdf')
      expect(result).toBe('')
    })

    it('handles plain text response (non-JSON)', async () => {
      const hub = makeServiceHub({
        error: '',
        content: [{ text: 'Plain text content directly' }],
      })
      service.setMcpService(hub.mcp())

      const result = await service.parseDocument('/tmp/doc.txt')
      expect(result).toBe('Plain text content directly')
    })
  })

  describe('callTool — retrieve', () => {
    it('calls fabric_search with correct collection_id for thread scope', async () => {
      const mockCallTool = vi.fn().mockResolvedValue({
        error: '',
        content: [
          {
            text: JSON.stringify({
              results: [
                {
                  chunkId: 'c1',
                  content: 'relevant text',
                  score: 0.85,
                  source: 'doc-1',
                  offset: 0,
                },
              ],
            }),
          },
        ],
      })
      service.setMcpService({ callTool: mockCallTool })

      const result = await service.callTool({
        toolName: 'retrieve',
        arguments: { query: 'test query', top_k: 5 },
        threadId: 'thread-123',
        scope: 'thread',
      })

      expect(result.error).toBe('')
      expect(mockCallTool).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'fabric_search',
          arguments: expect.objectContaining({
            query: 'test query',
            collection_id: 'thread_thread-123',
            top_k: 5,
            mode: 'hybrid',
          }),
        })
      )

      const payload = JSON.parse(result.content[0].text)
      expect(payload.citations).toHaveLength(1)
      expect(payload.citations[0].id).toBe('c1')
      expect(payload.citations[0].text).toBe('relevant text')
      expect(payload.citations[0].score).toBe(0.85)
    })

    it('uses project collection_id for project scope', async () => {
      const mockCallTool = vi.fn().mockResolvedValue({
        error: '',
        content: [{ text: JSON.stringify({ results: [] }) }],
      })
      service.setMcpService({ callTool: mockCallTool })

      await service.callTool({
        toolName: 'retrieve',
        arguments: { query: 'test' },
        projectId: 'proj-1',
        scope: 'project',
      })

      expect(mockCallTool).toHaveBeenCalledWith(
        expect.objectContaining({
          arguments: expect.objectContaining({
            collection_id: 'project_proj-1',
          }),
        })
      )
    })

    it('returns error when query is empty', async () => {
      service.setMcpService(makeServiceHub({ error: '', content: [] }).mcp())
      const result = await service.callTool({
        toolName: 'retrieve',
        arguments: {},
        threadId: 't1',
        scope: 'thread',
      })
      expect(result.error).toContain('Query is required')
    })

    it('returns error when no thread/project context', async () => {
      service.setMcpService(makeServiceHub({ error: '', content: [] }).mcp())
      const result = await service.callTool({
        toolName: 'retrieve',
        arguments: { query: 'test' },
        scope: 'thread',
      })
      expect(result.error).toContain('No thread or project')
    })
  })

  describe('callTool — list_attachments', () => {
    it('returns files from registry', async () => {
      useFileRegistry.getState().addFile('thread_t1', {
        file_id: 'f1',
        file_name: 'doc.pdf',
        file_path: '/tmp/doc.pdf',
        file_type: 'pdf',
        file_size: 1024,
        chunk_count: 5,
        collection_id: 'thread_t1',
        created_at: '2026-01-01T00:00:00Z',
      })

      const result = await service.callTool({
        toolName: 'list_attachments',
        arguments: {},
        threadId: 't1',
        scope: 'thread',
      })

      expect(result.error).toBe('')
      const payload = JSON.parse(result.content[0].text)
      expect(payload.attachments).toHaveLength(1)
      expect(payload.attachments[0].name).toBe('doc.pdf')
      expect(payload.attachments[0].chunk_count).toBe(5)
    })

    it('returns empty list when no files', async () => {
      const result = await service.callTool({
        toolName: 'list_attachments',
        arguments: {},
        threadId: 't1',
        scope: 'thread',
      })
      const payload = JSON.parse(result.content[0].text)
      expect(payload.attachments).toEqual([])
    })
  })

  describe('callTool — unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await service.callTool({
        toolName: 'nonexistent',
        arguments: {},
        threadId: 't1',
        scope: 'thread',
      })
      expect(result.error).toContain('Unknown RAG tool')
    })
  })
})
