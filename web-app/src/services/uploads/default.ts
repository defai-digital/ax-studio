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
  error?: string
  content?: Array<{ text?: string }>
  isError?: boolean
  is_error?: boolean
}): {
  filesSucceeded: number
  totalChunksGenerated: number
  errors: Array<{ path: string; message: string }>
} {
  const flagged = result.isError === true || result.is_error === true
  const errorText =
    typeof result.error === 'string' && result.error.trim()
      ? result.error.trim()
      : undefined
  if (flagged || errorText) {
    const detail =
      errorText ??
      result.content?.find((item) => item.text?.trim())?.text?.trim() ??
      'unknown error'
    throw new Error(`fabric_ingest_run failed: ${detail}`)
  }
  const text = result.content?.[0]?.text
  if (!text) {
    throw new Error('fabric_ingest_run returned empty response')
  }
  try {
    const metrics = JSON.parse(text)
    const filesSucceeded = firstPositiveIntegerMetric(
      metrics?.filesSucceeded,
      metrics?.files_succeeded,
      metrics?.succeeded,
      metrics?.succeededFiles,
      metrics?.processed_files,
      metrics?.filesProcessed,
      metrics?.successful_files,
      metrics?.ok
    )
    const totalChunksGenerated = firstPositiveIntegerMetric(
      metrics?.totalChunksGenerated,
      metrics?.total_chunks_generated,
      metrics?.chunksGenerated,
      metrics?.chunks_generated,
      metrics?.chunk_count,
      metrics?.chunks,
      metrics?.total_chunks
    )

    return {
      filesSucceeded,
      totalChunksGenerated,
      errors: normalizePipelineErrors(metrics?.errors),
    }
  } catch {
    throw new Error(`Failed to parse pipeline metrics: ${text.slice(0, 200)}`)
  }
}

function parsePositiveIntegerMetric(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined
  }

  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return undefined

  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function firstPositiveIntegerMetric(...values: unknown[]): number {
  for (const value of values) {
    const parsed = parsePositiveIntegerMetric(value)
    if (parsed !== undefined) return parsed
  }
  return 0
}

function normalizePipelineErrors(
  errors: unknown
): Array<{ path: string; message: string }> {
  if (!Array.isArray(errors)) return []
  return errors.map((error) => {
    if (typeof error === 'string') {
      return { path: '', message: error }
    }
    if (error && typeof error === 'object') {
      const record = error as Record<string, unknown>
      return {
        path: String(record.path ?? record.file ?? record.source_path ?? ''),
        message: String(record.message ?? record.error ?? record.reason ?? ''),
      }
    }
    return { path: '', message: String(error) }
  })
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

    const result = await hub.callTool({
      toolName: 'fabric_ingest_run',
      arguments: {
        source_paths: [attachment.path],
        collection_id: collectionId,
      },
    })

    const metrics = parsePipelineMetrics(result)

    if (metrics.filesSucceeded === 0) {
      const errorMsg =
        metrics.errors.length > 0
          ? metrics.errors.map((e) => e.message ?? e.path).join('; ')
          : 'No files were successfully indexed'
      throw new Error(`Document indexing failed: ${errorMsg}`)
    }

    const fileId = ulid()

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
