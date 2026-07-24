import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const readFileSync = vi.hoisted(() => vi.fn())

vi.mock('@ax-studio/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ax-studio/core')>()
  return {
    ...actual,
    fs: {
      ...(actual as { fs?: object }).fs,
      readFileSync,
    },
  }
})

import { DefaultRAGService } from '../rag/default'
import { useFileRegistry } from '@/lib/file-registry'
import type { ServiceHub } from '@/services'
import type { MCPService } from '../mcp/types'

function makeServiceHub(callToolResult: {
  error: string
  content: Array<{ text: string }>
  isError?: boolean
}): ServiceHub {
  return {
    mcp: () => ({
      callTool: vi.fn().mockResolvedValue(callToolResult),
    }),
  } as unknown as ServiceHub
}

describe('DefaultRAGService', () => {
  let service: DefaultRAGService
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    service = new DefaultRAGService()
    useFileRegistry.setState({ files: {} })
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
    consoleErrorSpy.mockRestore()
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
    beforeEach(() => {
      readFileSync.mockReset()
    })

    it('falls back to local text read when MCP is not set', async () => {
      readFileSync.mockResolvedValueOnce('local markdown body')
      const result = await service.parseDocument('/tmp/doc.md', 'md')
      expect(readFileSync).toHaveBeenCalledWith('/tmp/doc.md')
      expect(result).toBe('local markdown body')
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
      expect(readFileSync).not.toHaveBeenCalled()
    })

    it('falls back to local text when fabric_extract errors on a text file', async () => {
      const hub = makeServiceHub({
        error: 'file not found',
        content: [],
      })
      service.setMcpService(hub.mcp())
      readFileSync.mockResolvedValueOnce('recovered text')

      const result = await service.parseDocument('/tmp/notes.txt', 'txt')
      expect(result).toBe('recovered text')
    })

    it('returns empty string when fabric_extract fails and type is not locally readable', async () => {
      const hub = makeServiceHub({
        error: '',
        isError: true,
        content: [{ text: 'permission denied' }],
      })
      service.setMcpService(hub.mcp())

      // Must not treat error content text as the document body
      const result = await service.parseDocument('/tmp/locked.pdf', 'pdf')
      expect(result).toBe('')
      expect(readFileSync).not.toHaveBeenCalled()
    })

    it('uses native binary extraction when fabric_extract is unavailable', async () => {
      const core = {
        invoke: vi.fn().mockResolvedValue({
          text: '## Page 1\n\nNative PDF text',
          metadata: { format: 'pdf', unitCount: 1, truncated: false },
          warnings: [],
        }),
      }
      service.setCoreService(core as never)
      service.setMcpService({
        getTools: vi.fn().mockResolvedValue([
          { name: 'search' },
          { name: 'pack' },
          { name: 'memory_write' },
        ]),
        callTool: vi.fn(),
      })

      await expect(
        service.parseDocument('/tmp/report.pdf', 'pdf')
      ).resolves.toBe('## Page 1\n\nNative PDF text')
      expect(core.invoke).toHaveBeenCalledWith('extract_document_text', {
        path: '/tmp/report.pdf',
        fileType: 'pdf',
      })
      expect(service.canExtractBinaryDocuments()).toBe(true)
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

    it('returns error when fabric_search sets isError without top-level error', async () => {
      const mockCallTool = vi.fn().mockResolvedValue({
        error: '',
        isError: true,
        content: [{ text: 'index unavailable' }],
      })
      service.setMcpService({ callTool: mockCallTool })

      const result = await service.callTool({
        toolName: 'retrieve',
        arguments: { query: 'test query' },
        threadId: 'thread-123',
        scope: 'thread',
      })

      expect(result.error).toContain('index unavailable')
      expect(result.error).toMatch(/Search failed/)
    })

    it('uses latest AkiDB pack when fabric_search is absent', async () => {
      const mockCallTool = vi.fn().mockResolvedValue({
        error: '',
        content: [{ text: 'Packed context from latest AkiDB' }],
      })
      service.setMcpService({
        getTools: vi.fn().mockResolvedValue([
          { name: 'search' },
          { name: 'pack' },
          { name: 'memory_write' },
          { name: 'memory_read' },
          { name: 'status' },
        ]),
        callTool: mockCallTool,
      } as unknown as MCPService)

      const result = await service.callTool({
        toolName: 'retrieve',
        arguments: { query: 'markdown', top_k: 3 },
        threadId: 'thread-123',
        scope: 'thread',
      })

      expect(result.error).toBe('')
      expect(mockCallTool).toHaveBeenCalledWith({
        toolName: 'pack',
        arguments: expect.objectContaining({
          query: 'markdown',
          top_k: 3,
          workspace: 'thread_thread-123',
        }),
      })
      const payload = JSON.parse(result.content[0].text)
      expect(payload.mode).toBe('akidb-pack')
      expect(payload.citations[0].text).toBe('Packed context from latest AkiDB')
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

    it('rejects invalid top_k before calling fabric_search', async () => {
      const mockCallTool = vi.fn()
      service.setMcpService({ callTool: mockCallTool })

      const result = await service.callTool({
        toolName: 'retrieve',
        arguments: { query: 'test', top_k: Number.POSITIVE_INFINITY },
        threadId: 't1',
        scope: 'thread',
      })

      expect(result.error).toContain(
        'top_k must be a whole number between 1 and 10'
      )
      expect(mockCallTool).not.toHaveBeenCalled()
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

  describe('callTool — get_chunks', () => {
    it('calls fabric_search with a validated chunk range', async () => {
      const mockCallTool = vi.fn().mockResolvedValue({
        error: '',
        content: [
          {
            text: JSON.stringify({
              results: [
                {
                  chunkId: 'chunk-1',
                  content: 'chunk text',
                  score: 0.7,
                  offset: 2,
                },
              ],
            }),
          },
        ],
      })
      service.setMcpService({ callTool: mockCallTool })

      const result = await service.callTool({
        toolName: 'get_chunks',
        arguments: { file_id: 'file-1', start_order: '2', end_order: 4 },
        threadId: 'thread-123',
        scope: 'thread',
      })

      expect(result.error).toBe('')
      expect(mockCallTool).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: 'fabric_search',
          arguments: expect.objectContaining({
            query: '',
            collection_id: 'thread_thread-123',
            mode: 'keyword',
            filters: { doc_id: 'file-1' },
          }),
        })
      )
      // top_k must cover the requested order range, not merely range size
      const topK = mockCallTool.mock.calls[0][0].arguments.top_k as number
      expect(topK).toBeGreaterThanOrEqual(5)

      const payload = JSON.parse(result.content[0].text)
      expect(payload.chunks).toHaveLength(1)
      expect(payload.chunks[0].id).toBe('chunk-1')
      expect(payload.chunks[0].chunk_file_order).toBe(2)
    })

    it('filters and sorts chunks by chunk_file_order within start/end range', async () => {
      const mockCallTool = vi.fn().mockResolvedValue({
        error: '',
        content: [
          {
            text: JSON.stringify({
              results: [
                { chunkId: 'c0', content: 'zero', score: 0.9, offset: 0 },
                { chunkId: 'c3', content: 'three', score: 0.8, offset: 3 },
                { chunkId: 'c1', content: 'one', score: 0.7, offset: 1 },
                { chunkId: 'c5', content: 'five', score: 0.6, offset: 5 },
                { chunkId: 'c2', content: 'two', score: 0.5, offset: 2 },
              ],
            }),
          },
        ],
      })
      service.setMcpService({ callTool: mockCallTool })

      const result = await service.callTool({
        toolName: 'get_chunks',
        arguments: { file_id: 'file-1', start_order: 1, end_order: 3 },
        threadId: 'thread-123',
        scope: 'thread',
      })

      expect(result.error).toBe('')
      const payload = JSON.parse(result.content[0].text)
      expect(payload.chunks.map((c: { id: string }) => c.id)).toEqual([
        'c1',
        'c2',
        'c3',
      ])
      expect(
        payload.chunks.map((c: { chunk_file_order: number }) => c.chunk_file_order)
      ).toEqual([1, 2, 3])
    })

    it('returns error when fabric_search sets isError without top-level error', async () => {
      const mockCallTool = vi.fn().mockResolvedValue({
        error: '',
        isError: true,
        content: [{ text: 'collection missing' }],
      })
      service.setMcpService({ callTool: mockCallTool })

      const result = await service.callTool({
        toolName: 'get_chunks',
        arguments: { file_id: 'file-1', start_order: 0, end_order: 2 },
        threadId: 'thread-123',
        scope: 'thread',
      })

      expect(result.error).toContain('collection missing')
      expect(result.error).toMatch(/get_chunks failed/)
    })

    it('reconstructs chunks locally for latest AkiDB text attachments', async () => {
      const fileId = 'file-1'
      useFileRegistry.getState().addFile('thread_thread-123', {
        file_id: fileId,
        file_name: 'notes.md',
        file_path: '/tmp/notes.md',
        file_type: 'md',
        file_size: 100,
        chunk_count: 1,
        collection_id: 'thread_thread-123',
        created_at: '2026-01-01T00:00:00Z',
      })
      readFileSync.mockResolvedValueOnce('one\n\ntwo\n\nthree')
      const mockCallTool = vi.fn()
      service.setMcpService({
        getTools: vi.fn().mockResolvedValue([
          { name: 'search' },
          { name: 'pack' },
          { name: 'memory_write' },
        ]),
        callTool: mockCallTool,
      } as unknown as MCPService)

      const result = await service.callTool({
        toolName: 'get_chunks',
        arguments: { file_id: fileId, start_order: 0, end_order: 0 },
        threadId: 'thread-123',
        scope: 'thread',
      })

      expect(result.error).toBe('')
      expect(mockCallTool).not.toHaveBeenCalled()
      const payload = JSON.parse(result.content[0].text)
      expect(payload.chunks).toHaveLength(1)
      expect(payload.chunks[0].text).toContain('one')
    })

    it('rejects non-integer chunk ranges before calling fabric_search', async () => {
      const mockCallTool = vi.fn()
      service.setMcpService({ callTool: mockCallTool })

      const result = await service.callTool({
        toolName: 'get_chunks',
        arguments: { file_id: 'file-1', start_order: '1.5', end_order: 2 },
        threadId: 't1',
        scope: 'thread',
      })

      expect(result.error).toContain(
        'start_order and end_order must be non-negative whole numbers'
      )
      expect(mockCallTool).not.toHaveBeenCalled()
    })

    it('rejects reversed chunk ranges before calling fabric_search', async () => {
      const mockCallTool = vi.fn()
      service.setMcpService({ callTool: mockCallTool })

      const result = await service.callTool({
        toolName: 'get_chunks',
        arguments: { file_id: 'file-1', start_order: 5, end_order: 4 },
        threadId: 't1',
        scope: 'thread',
      })

      expect(result.error).toContain(
        'end_order must be greater than or equal to start_order'
      )
      expect(mockCallTool).not.toHaveBeenCalled()
    })

    it('rejects non-string file ids before calling fabric_search', async () => {
      const mockCallTool = vi.fn()
      service.setMcpService({ callTool: mockCallTool })

      const result = await service.callTool({
        toolName: 'get_chunks',
        arguments: { file_id: 123, start_order: 0, end_order: 1 },
        threadId: 't1',
        scope: 'thread',
      })

      expect(result.error).toContain('file_id is required')
      expect(mockCallTool).not.toHaveBeenCalled()
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
