/**
 * Ax-Studio Retrieval Service client
 *
 * Replaces the deleted RAGExtension.  All retrieval operations (tool listing,
 * tool calls, document parsing) are delegated to the self-hosted Retrieval
 * Service via HTTP.  The service URL is read from the persisted
 * useAxStudioConfig store (defaults to http://127.0.0.1:8001).
 */

import type { RAGService } from './types'
import type { MCPTool, MCPToolCallResult } from '@ax-studio/core'
import { getToolsResponseSchema, mcpToolCallResultSchema, parseDocumentResponseSchema } from '@/schemas/rag.schema'
import { getRetrievalServiceUrl, doFetch } from '@/services/retrieval/client'

export class DefaultRAGService implements RAGService {
  async getTools(): Promise<MCPTool[]> {
    try {
      const baseUrl = getRetrievalServiceUrl()
      const response = await doFetch(`${baseUrl}/tools`, { method: 'GET' })
      if (!response.ok) {
        console.warn(`Retrieval service GET /tools returned ${response.status}`)
        return []
      }
      const data = await response.json()
      const parsed = getToolsResponseSchema.safeParse(data)
      if (!parsed.success) {
        console.warn('Retrieval service /tools response did not match expected schema:', parsed.error.message)
        return []
      }
      return parsed.data.tools as MCPTool[]
    } catch (e) {
      console.warn('Retrieval service getTools unavailable:', e)
      return []
    }
  }

  async callTool(args: {
    toolName: string
    arguments: Record<string, unknown>
    threadId?: string
    projectId?: string
    scope: 'project' | 'thread'
  }): Promise<MCPToolCallResult> {
    try {
      const baseUrl = getRetrievalServiceUrl()
      const response = await doFetch(`${baseUrl}/tools/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool_name: args.toolName,
          arguments: args.arguments,
          thread_id: args.threadId,
          project_id: args.projectId,
          scope: args.scope,
        }),
      })
      if (!response.ok) {
        const errText = await response.text().catch(() => response.statusText)
        return {
          error: `Retrieval service error ${response.status}: ${errText}`,
          content: [
            { type: 'text', text: `Retrieval tool call failed (${response.status})` },
          ],
        }
      }
      const result = mcpToolCallResultSchema.safeParse(await response.json())
      if (!result.success) {
        console.warn('Retrieval service /tools/call response did not match expected schema:', result.error.message)
        return {
          error: 'Unexpected response format from retrieval service',
          content: [{ type: 'text', text: 'Retrieval tool call returned unexpected format' }],
        }
      }
      return result.data as MCPToolCallResult
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return {
        error: msg,
        content: [{ type: 'text', text: `Retrieval tool call failed: ${msg}` }],
      }
    }
  }

  async getToolNames(): Promise<string[]> {
    const tools = await this.getTools()
    return tools.map((t) => t.name)
  }

  async parseDocument(path: string, type?: string): Promise<string> {
    try {
      const baseUrl = getRetrievalServiceUrl()
      const response = await doFetch(`${baseUrl}/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, type }),
      })
      if (!response.ok) {
        console.warn(`Retrieval service POST /parse returned ${response.status}`)
        return ''
      }
      const data = await response.json()
      return parseDocumentResponseSchema.safeParse(data).data?.content ?? ''
    } catch (e) {
      console.debug('Retrieval service parseDocument unavailable:', e)
      return ''
    }
  }
}
