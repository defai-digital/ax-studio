/**
 * AkiDB-backed Uploads service.
 *
 * Document ingestion is delegated to the ax-studio MCP server which runs the
 * full AkiDB pipeline (extract → chunk → embed → upsert → publish) in a
 * single `fabric_ingest_run` call.
 *
 * Image ingestion is unchanged — images are delivered to the model as base64
 * content parts, not indexed in a vector store.
 */

import type { UploadsService, UploadResult } from './types'
import type { MCPService } from '../mcp/types'
import type { Attachment } from '@/types/attachment'
import { ulid } from 'ulidx'
import {
  useFileRegistry,
  threadCollectionId,
  projectCollectionId,
} from '@/lib/file-registry'

/** Cached result of the MCP availability probe (reset on each service construction). */
let mcpAvailabilityChecked = false
let mcpAvailable = false

async function ensureAkidbAvailable(mcp: MCPService): Promise<void> {
  if (mcpAvailabilityChecked && mcpAvailable) return
  try {
    const tools = await mcp.getTools()
    mcpAvailable = tools.some(
      (t) => t.name === 'fabric_ingest_run' || t.name === 'fabric_search'
    )
    mcpAvailabilityChecked = true
  } catch {
    mcpAvailable = false
    mcpAvailabilityChecked = true
  }
  if (!mcpAvailable) {
    throw new Error(
      'AkiDB is not configured. Enable the ax-studio MCP server in Settings → MCP Servers to use document indexing.'
    )
  }
}

/**
 * Parse the JSON content returned by `fabric_ingest_run` MCP tool.
 *
 * The tool returns `MCPToolCallResult` whose first `content[].text` is a
 * JSON-encoded `PipelineMetrics` object from ax-fabric.
 */
function parsePipelineMetrics(result: {
  error: string
  content: Array<{ text: string }>
}): {
  filesSucceeded: number
  totalChunksGenerated: number
  errors: Array<{ path: string; message: string }>
} {
  if (result.error) {
    throw new Error(`fabric_ingest_run failed: ${result.error}`)
  }
  const text = result.content?.[0]?.text
  if (!text) {
    throw new Error('fabric_ingest_run returned empty response')
  }
  try {
    const metrics = JSON.parse(text)
    // Use `Number(...) || 0` instead of `?? 0` so a string-typed count
    // from an older MCP server version (`"1"`) is coerced to a number
    // rather than flowing through and breaking downstream arithmetic.
    return {
      filesSucceeded: Number(metrics?.filesSucceeded) || 0,
      totalChunksGenerated: Number(metrics?.totalChunksGenerated) || 0,
      errors: Array.isArray(metrics?.errors) ? metrics.errors : [],
    }
  } catch {
    throw new Error(`Failed to parse pipeline metrics: ${text.slice(0, 200)}`)
  }
}

export class DefaultUploadsService implements UploadsService {
  private mcpService: MCPService | null = null

  /**
   * Called once during ServiceHub initialization to give us a back-reference
   * so we can call `mcp()`.  If the hub has not been set the
   * service falls back to the no-op behaviour (returns a generated id).
   */
  setMcpService(mcp: MCPService): void {
    this.mcpService = mcp
    // Reset the cache when the hub is (re-)set so the next call re-probes.
    mcpAvailabilityChecked = false
  }

  // ── Images — unchanged, no vector indexing ────────────────────────────

  async ingestImage(
    _threadId: string,
    attachment: Attachment
  ): Promise<UploadResult> {
    if (attachment.type !== 'image')
      throw new Error('ingestImage: attachment is not image')
    return { id: ulid() }
  }

  // ── Documents — AkiDB-backed ingestion ────────────────────────────────

  async ingestFileAttachment(
    threadId: string,
    attachment: Attachment
  ): Promise<UploadResult> {
    if (attachment.type !== 'document')
      throw new Error('ingestFileAttachment: attachment is not document')
    if (!attachment.path)
      throw new Error('ingestFileAttachment: attachment has no file path')

    return this.ingestDocument(threadCollectionId(threadId), attachment)
  }

  async ingestFileAttachmentForProject(
    projectId: string,
    attachment: Attachment
  ): Promise<UploadResult> {
    if (attachment.type !== 'document')
      throw new Error(
        'ingestFileAttachmentForProject: attachment is not document'
      )
    if (!attachment.path)
      throw new Error(
        'ingestFileAttachmentForProject: attachment has no file path'
      )

    return this.ingestDocument(projectCollectionId(projectId), attachment)
  }

  // ── Private ───────────────────────────────────────────────────────────

  private async ingestDocument(
    collectionId: string,
    attachment: Attachment
  ): Promise<UploadResult> {
    const hub = this.mcpService
    if (!hub) {
      // Fallback when service hub is not yet initialized (web-only dev mode)
      console.warn(
        'UploadsService: ServiceHub not set — returning generated id'
      )
      return { id: ulid() }
    }

    await ensureAkidbAvailable(hub)

    console.log('[Uploads] ingestDocument: calling fabric_ingest_run', {
      path: attachment.path,
      collectionId,
    })
    const result = await hub.callTool({
      toolName: 'fabric_ingest_run',
      arguments: {
        source_paths: [attachment.path],
        collection_id: collectionId,
      },
    })

    const metrics = parsePipelineMetrics(result)
    console.log('[Uploads] fabric_ingest_run result:', metrics)

    if (metrics.filesSucceeded === 0) {
      const errorMsg =
        metrics.errors.length > 0
          ? metrics.errors.map((e) => e.message ?? e.path).join('; ')
          : 'No files were successfully indexed'
      throw new Error(`Document indexing failed: ${errorMsg}`)
    }

    const fileId = ulid()
    console.log('[Uploads] ingestDocument success:', {
      fileId,
      chunkCount: metrics.totalChunksGenerated,
    })

    useFileRegistry.getState().addFile(collectionId, {
      file_id: fileId,
      file_name: attachment.name,
      file_path: attachment.path!,
      file_type: attachment.fileType,
      file_size: attachment.size,
      chunk_count: metrics.totalChunksGenerated,
      collection_id: collectionId,
      created_at: new Date().toISOString(),
    })

    return {
      id: fileId,
      size: attachment.size,
      chunkCount: metrics.totalChunksGenerated,
    }
  }
}
