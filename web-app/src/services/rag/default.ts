/**
 * No-op RAG service.
 *
 * The self-hosted Retrieval Service (port 8001) has been removed.
 * This stub satisfies the RAGService interface so the rest of the app
 * compiles and runs without errors. All methods return empty/no-op results.
 */

import type { RAGService } from './types'
import type { MCPTool, MCPToolCallResult } from '@ax-studio/core'

export class DefaultRAGService implements RAGService {
  async getTools(): Promise<MCPTool[]> {
    return []
  }

  async callTool(): Promise<MCPToolCallResult> {
    return {
      error: 'Retrieval service is not available',
      content: [{ type: 'text', text: 'Retrieval service is not configured.' }],
    }
  }

  async getToolNames(): Promise<string[]> {
    return []
  }

  async parseDocument(): Promise<string> {
    return ''
  }
}
