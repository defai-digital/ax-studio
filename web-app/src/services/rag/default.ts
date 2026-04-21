/**
 * AkiDB-backed RAG service.
 *
 * Provides three retrieval tools (retrieve, list_attachments, get_chunks) that
 * the AI model can call during chat.  All vector operations are delegated to
 * the ax-studio MCP server's `fabric_search` tool.
 *
 * Document parsing for inline injection is handled by `fabric_extract`.
 */

import type { RAGService } from './types'
import type { MCPService } from '../mcp/types'
import type { MCPTool, MCPToolCallResult } from '@ax-studio/core'
import {
  useFileRegistry,
  threadCollectionId,
  projectCollectionId,
} from '@/lib/file-registry'

const RAG_SERVER = 'rag-internal'

const RAG_TOOLS: MCPTool[] = [
  {
    name: 'retrieve',
    server: RAG_SERVER,
    description:
      'Search attached documents for relevant content using semantic and keyword search',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query',
        },
        top_k: {
          type: 'number',
          minimum: 1,
          maximum: 10,
          default: 3,
          description: 'Number of results to return',
        },
        file_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: restrict search to specific files',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_attachments',
    server: RAG_SERVER,
    description: 'List all documents attached to this conversation',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_chunks',
    server: RAG_SERVER,
    description:
      'Get specific text chunks from an attached document by order range',
    inputSchema: {
      type: 'object',
      properties: {
        file_id: { type: 'string', description: 'File identifier' },
        start_order: {
          type: 'number',
          description: 'Start chunk index (inclusive)',
        },
        end_order: {
          type: 'number',
          description: 'End chunk index (inclusive)',
        },
      },
      required: ['file_id', 'start_order', 'end_order'],
    },
  },
]

const RAG_TOOL_NAMES = RAG_TOOLS.map((t) => t.name)

function ok(payload: unknown): MCPToolCallResult {
  return {
    error: '',
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  }
}

function fail(message: string): MCPToolCallResult {
  return {
    error: message,
    content: [{ type: 'text', text: message }],
  }
}

export class DefaultRAGService implements RAGService {
  private mcpService: MCPService | null = null

  setMcpService(mcp: MCPService): void {
    this.mcpService = mcp
  }

  // ── Tool definitions ──────────────────────────────────────────────────

  async getTools(): Promise<MCPTool[]> {
    return RAG_TOOLS
  }

  async getToolNames(): Promise<string[]> {
    return RAG_TOOL_NAMES
  }

  // ── Tool execution ────────────────────────────────────────────────────

  async callTool(args: {
    toolName: string
    arguments: Record<string, unknown>
    threadId?: string
    projectId?: string
    scope: 'project' | 'thread'
  }): Promise<MCPToolCallResult> {
    switch (args.toolName) {
      case 'retrieve':
        return this.handleRetrieve(args)
      case 'list_attachments':
        return await this.handleListAttachments(args)
      case 'get_chunks':
        return this.handleGetChunks(args)
      default:
        return fail(`Unknown RAG tool: ${args.toolName}`)
    }
  }

  // ── Document parsing (inline mode) ────────────────────────────────────

  async parseDocument(path: string, _type?: string): Promise<string> {
    const hub = this.mcpService
    if (!hub) {
      console.warn('[RAG] parseDocument: ServiceHub not available')
      return ''
    }

    try {
      const result = await hub.callTool({
        toolName: 'fabric_extract',
        arguments: { file_path: path },
      })

      if (result.error) {
        console.warn('[RAG] fabric_extract error:', result.error)
        return ''
      }

      const text = result.content?.[0]?.text
      if (!text) {
        console.warn('[RAG] fabric_extract returned empty content')
        return ''
      }

      try {
        const parsed = JSON.parse(text)
        const content = typeof parsed.text === 'string' ? parsed.text : ''
        return content
      } catch {
        return text
      }
    } catch (err) {
      console.error('[RAG] parseDocument failed:', err)
      return ''
    }
  }

  // ── Private handlers ──────────────────────────────────────────────────

  private resolveCollectionId(args: {
    threadId?: string
    projectId?: string
    scope: 'project' | 'thread'
  }): string | null {
    if (args.scope === 'project' && args.projectId) {
      return projectCollectionId(args.projectId)
    }
    if (args.threadId) {
      return threadCollectionId(args.threadId)
    }
    return null
  }

  private async handleRetrieve(args: {
    arguments: Record<string, unknown>
    threadId?: string
    projectId?: string
    scope: 'project' | 'thread'
  }): Promise<MCPToolCallResult> {
    const hub = this.mcpService
    if (!hub) return fail('Service hub not available')

    const collectionId = this.resolveCollectionId(args)
    if (!collectionId) return fail('No thread or project context for retrieve')

    const query = String(args.arguments.query ?? '')
    if (!query) return fail('Query is required for retrieve')

    const topK =
      typeof args.arguments.top_k === 'number' ? args.arguments.top_k : 3

    try {
      const searchArgs: Record<string, unknown> = {
        query,
        collection_id: collectionId,
        top_k: topK,
        mode: 'hybrid',
      }

      // If file_ids filter is provided, add metadata filters
      if (
        Array.isArray(args.arguments.file_ids) &&
        args.arguments.file_ids.length > 0
      ) {
        searchArgs.filters = {
          doc_id: { $in: args.arguments.file_ids },
        }
      }

      const result = await hub.callTool({
        toolName: 'fabric_search',
        arguments: searchArgs,
      })

      if (result.error) {
        return fail(`Search failed: ${result.error}`)
      }

      const text = result.content?.[0]?.text ?? '{}'
      let searchResponse: { results?: Array<Record<string, unknown>> }
      try {
        searchResponse = JSON.parse(text)
      } catch (err) {
        console.warn('[RAG] Failed to parse search response:', err)
        return fail(`Search returned unparseable response: ${typeof text === 'string' ? text.slice(0, 200) : 'empty'}`)
      }

      const citations = (searchResponse.results ?? []).map((r) => ({
        id: r.chunkId ?? r.chunk_id ?? '',
        text: r.content ?? r.text ?? '',
        score: r.score ?? 0,
        file_id: r.source ?? r.doc_id ?? '',
        chunk_file_order: r.offset ?? 0,
      }))

      return ok({
        thread_id: args.threadId,
        project_id: args.projectId,
        scope: args.scope,
        query,
        citations,
        mode: 'hybrid',
      })
    } catch (err) {
      return fail(
        `Retrieve error: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }

  private async handleListAttachments(args: {
    threadId?: string
    projectId?: string
    scope: 'project' | 'thread'
  }): Promise<MCPToolCallResult> {
    const collectionId = this.resolveCollectionId(args)
    if (!collectionId) return fail('No thread or project context')

    const entries = useFileRegistry.getState().listFiles(collectionId)

    return ok({
      thread_id: args.threadId,
      project_id: args.projectId,
      scope: args.scope,
      attachments: entries.map((e) => ({
        id: e.file_id,
        name: e.file_name,
        path: e.file_path,
        type: e.file_type,
        size: e.file_size,
        chunk_count: e.chunk_count,
      })),
    })
  }

  private async handleGetChunks(args: {
    arguments: Record<string, unknown>
    threadId?: string
    projectId?: string
    scope: 'project' | 'thread'
  }): Promise<MCPToolCallResult> {
    const hub = this.mcpService
    if (!hub) return fail('Service hub not available')

    const collectionId = this.resolveCollectionId(args)
    if (!collectionId) return fail('No thread or project context')

    const fileId = String(args.arguments.file_id ?? '')
    const startOrder = Number(args.arguments.start_order ?? 0)
    const endOrder = Number(args.arguments.end_order ?? 0)

    if (!fileId) return fail('file_id is required')

    try {
      const result = await hub.callTool({
        toolName: 'fabric_search',
        arguments: {
          query: '',
          collection_id: collectionId,
          top_k: Math.max(endOrder - startOrder + 1, 1),
          mode: 'keyword',
          filters: { doc_id: fileId },
        },
      })

      if (result.error) {
        return fail(`get_chunks failed: ${result.error}`)
      }

      const text = result.content?.[0]?.text ?? '{}'
      let parsed: { results?: Array<Record<string, unknown>> }
      try {
        parsed = JSON.parse(text)
      } catch (err) {
        console.warn('[RAG] Failed to parse chunks response:', err)
        return fail(`Chunks returned unparseable response: ${typeof text === 'string' ? text.slice(0, 200) : 'empty'}`)
      }

      const chunks = (parsed.results ?? []).map((r) => ({
        id: r.chunkId ?? r.chunk_id ?? '',
        text: r.content ?? r.text ?? '',
        score: r.score ?? 0,
        file_id: fileId,
        chunk_file_order: r.offset ?? 0,
      }))

      return ok({
        thread_id: args.threadId,
        scope: args.scope,
        file_id: fileId,
        chunks,
      })
    } catch (err) {
      return fail(
        `get_chunks error: ${err instanceof Error ? err.message : String(err)}`
      )
    }
  }
}
