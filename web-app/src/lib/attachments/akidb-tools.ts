/**
 * Attachment indexing MCP tool contracts (ADR-005).
 *
 * Capability is determined from **tool names present**, never from a server
 * key (`ax-studio` / `akidb`) alone. AkiDB v0.9 tools (`search`/`pack`/
 * `memory_*`/`status`) are NOT fabric-ingest compatible and must not enable
 * binary attachment indexing.
 */

/** Fabric-ingest contract used by uploads + RAG parse paths. */
const FABRIC_ATTACHMENT_TOOL_NAMES = new Set([
  'fabric_ingest_run',
  'fabric_extract',
  'fabric_search',
])

/** AkiDB v0.9 memory/retrieval surface — not a drop-in for fabric_*. */
const AKI_V09_TOOL_NAMES = new Set([
  'search',
  'pack',
  'memory_write',
  'memory_read',
  'status',
])

export type NamedMcpTool = { name: string }

/**
 * Three honest states for attachment indexing (UXQ-014 / UXQ-015 / ADR-005).
 * - none: no fabric and no AkiDB v0.9 tools
 * - aki-v09-only: latest AkiDB memory/search surface only
 * - fabric-compatible: at least one fabric_* attachment tool present
 */
export type AttachmentIndexerCapability =
  | 'none'
  | 'aki-v09-only'
  | 'fabric-compatible'

export function classifyAttachmentIndexerCapability(
  tools: NamedMcpTool[]
): AttachmentIndexerCapability {
  const names = tools.map((t) => t.name)
  const hasFabric = names.some((n) => FABRIC_ATTACHMENT_TOOL_NAMES.has(n))
  if (hasFabric) return 'fabric-compatible'
  const hasAkiV09 = names.some((n) => AKI_V09_TOOL_NAMES.has(n))
  if (hasAkiV09) return 'aki-v09-only'
  return 'none'
}

/** True when any fabric attachment tool is present (ingest/extract/search). */
export function hasAkidbAttachmentTools(tools: NamedMcpTool[]): boolean {
  return classifyAttachmentIndexerCapability(tools) === 'fabric-compatible'
}

/**
 * Tools needed to open the attach+index pipeline (binary extract/ingest).
 * fabric_search alone is not sufficient to index a new PDF/DOCX.
 */
export function hasAkidbIngestOrExtractTools(tools: NamedMcpTool[]): boolean {
  return tools.some(
    (t) => t.name === 'fabric_ingest_run' || t.name === 'fabric_extract'
  )
}

/** Whether binary document indexing should be offered / attempted. */
export function canIndexBinaryAttachments(tools: NamedMcpTool[]): boolean {
  return hasAkidbIngestOrExtractTools(tools)
}

/**
 * Plain-language skip copy for binary files when indexing is unavailable.
 * Never mentions AX BI MCP or generic tool toggles (UXQ-015).
 */
export function binaryAttachmentSkipMessage(
  capability: AttachmentIndexerCapability
): string {
  if (capability === 'aki-v09-only') {
    return (
      'The connected AkiDB server lacks compatible document-indexing tools ' +
      '(fabric_ingest_run / fabric_extract). Binary files (PDF/DOCX) cannot be ' +
      'indexed yet — see Settings → MCP Servers.'
    )
  }
  return (
    'PDF/DOCX and other binary documents need a fabric-compatible AkiDB MCP ' +
    'server for reading — see Settings → MCP Servers.'
  )
}

/**
 * Error thrown by uploads when fabric_ingest_run cannot run.
 * Distinguishes missing indexer vs AkiDB v0.9 contract mismatch.
 */
export function unavailableIndexerErrorMessage(
  capability: AttachmentIndexerCapability
): string {
  if (capability === 'aki-v09-only') {
    return (
      'The connected AkiDB version lacks compatible document-indexing tools ' +
      '(fabric_ingest_run / fabric_extract). Binary indexing is unavailable ' +
      'until a fabric-compatible indexer is configured in Settings → MCP Servers.'
    )
  }
  return (
    'Document indexing is not available. Connect a fabric-compatible AkiDB ' +
    'MCP server in Settings → MCP Servers (search/pack-only AkiDB builds ' +
    'cannot index PDF/DOCX).'
  )
}
