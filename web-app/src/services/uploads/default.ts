/**
 * AkiDB-backed Uploads service.
 *
 * Document ingestion is delegated to the ax-studio MCP server which runs the
 * full AkiDB pipeline (extract → chunk → embed → upsert → publish) in a
 * single `fabric_ingest_run` call. Latest AkiDB builds that expose
 * `memory_write`/`pack` are supported through AX Studio's bounded local
 * document extractor and compatibility adapter.
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
  fabricDocumentId,
} from '@/lib/file-registry'
import {
  canIndexTextAttachments,
  classifyAttachmentIndexerCapability,
  unavailableIndexerErrorMessage,
  type AttachmentIndexerCapability,
} from '@/lib/attachments/akidb-tools'
import { indexAttachmentWithAkiV09Memory } from '@/lib/attachments/aki-v09-compat'
import { extractDocumentText } from '@/lib/attachments/document-extraction'
import type { CoreService } from '@/services/core/types'

/**
 * Gate document indexing: fabric_ingest_run supports the full binary pipeline;
 * latest AkiDB memory_write/pack supports locally extracted documents.
 */
export async function ensureAkidbAvailable(mcp: MCPService): Promise<void> {
  let capability: AttachmentIndexerCapability = 'none'
  try {
    const tools = await mcp.getTools()
    capability = classifyAttachmentIndexerCapability(tools)
    const hasIngest = tools.some((t) => t.name === 'fabric_ingest_run')
    if (hasIngest) return
    if (canIndexTextAttachments(tools)) return
  } catch {
    capability = 'none'
  }
  throw new Error(unavailableIndexerErrorMessage(capability))
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
    const filesSucceeded = firstNonNegativeIntegerMetric(
      metrics?.filesSucceeded,
      metrics?.files_succeeded,
      metrics?.succeeded,
      metrics?.succeededFiles,
      metrics?.processed_files,
      metrics?.filesProcessed,
      metrics?.successful_files,
      metrics?.ok
    )
    const totalChunksGenerated = firstNonNegativeIntegerMetric(
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

/**
 * Parse a non-negative integer metric. Explicit `0` is valid (e.g. zero files
 * succeeded) and must not fall through to alias fields.
 */
function parseNonNegativeIntegerMetric(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined
  }

  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return undefined

  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function firstNonNegativeIntegerMetric(...values: unknown[]): number {
  for (const value of values) {
    // Skip only truly missing fields — not 0.
    if (value === undefined || value === null || value === '') continue
    const parsed = parseNonNegativeIntegerMetric(value)
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
  private coreService: CoreService | null = null

  /**
   * Called once during ServiceHub initialization to give us a back-reference
   * so we can call `mcp()`.  If the hub has not been set the
   * service falls back to the no-op behaviour (returns a generated id).
   */
  setMcpService(mcp: MCPService): void {
    this.mcpService = mcp
  }

  setCoreService(core: CoreService): void {
    this.coreService = core
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

    let tools: Awaited<ReturnType<MCPService['getTools']>> = []
    try {
      tools = await hub.getTools()
    } catch {
      await ensureAkidbAvailable(hub)
    }

    const hasFabricIngest = tools.some((t) => t.name === 'fabric_ingest_run')
    if (!hasFabricIngest && canIndexTextAttachments(tools)) {
      return this.ingestDocumentWithAkiV09(collectionId, attachment, hub)
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

    const path = attachment.path!
    const existing = useFileRegistry
      .getState()
      .listFiles(collectionId)
      .find((file) => file.file_path === path)
    // ax-fabric uses SHA-256(sourcePath) as doc_id. Returning that same value is
    // required for file-scoped search, get_chunks, and chunk deletion filters.
    const fileId = fabricDocumentId(path)

    useFileRegistry.getState().addFile(collectionId, {
      file_id: fileId,
      file_name: attachment.name,
      file_path: path,
      file_type: attachment.fileType,
      file_size: attachment.size,
      chunk_count: metrics.totalChunksGenerated,
      collection_id: collectionId,
      created_at: existing?.created_at ?? new Date().toISOString(),
    })

    return {
      id: fileId,
      size: attachment.size,
      chunkCount: metrics.totalChunksGenerated,
    }
  }

  private async ingestDocumentWithAkiV09(
    collectionId: string,
    attachment: Attachment,
    hub: MCPService
  ): Promise<UploadResult> {
    const extracted = await extractDocumentText({
      path: attachment.path!,
      fileType: attachment.fileType,
      core: this.coreService,
    })
    const result = await indexAttachmentWithAkiV09Memory({
      mcp: hub,
      collectionId,
      attachment,
      extractedText: extracted.text,
    })

    const path = attachment.path!
    const existing = useFileRegistry
      .getState()
      .listFiles(collectionId)
      .find((file) => file.file_path === path)

    useFileRegistry.getState().addFile(collectionId, {
      file_id: result.fileId,
      file_name: attachment.name,
      file_path: path,
      file_type: attachment.fileType,
      file_size: result.size,
      chunk_count: result.chunkCount,
      collection_id: collectionId,
      created_at: existing?.created_at ?? new Date().toISOString(),
    })

    return {
      id: result.fileId,
      size: result.size,
      chunkCount: result.chunkCount,
    }
  }
}
