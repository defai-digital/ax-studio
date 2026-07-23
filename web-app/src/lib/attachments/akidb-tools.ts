/**
 * AkiDB / fabric-ingest MCP tools used for document indexing and extract.
 * These tools only exist when an ax-studio (or equivalent) fabric-ingest
 * MCP server is connected — not from AX BI MCP.
 */

const AKIDB_ATTACHMENT_TOOL_NAMES = new Set([
  'fabric_ingest_run',
  'fabric_extract',
  'fabric_search',
])

export type NamedMcpTool = { name: string }

/** True when any tool required for document indexing/extract is present. */
export function hasAkidbAttachmentTools(tools: NamedMcpTool[]): boolean {
  return tools.some((t) => AKIDB_ATTACHMENT_TOOL_NAMES.has(t.name))
}

/** Tools specifically needed to open/use the attach+index pipeline. */
export function hasAkidbIngestOrExtractTools(tools: NamedMcpTool[]): boolean {
  return tools.some(
    (t) => t.name === 'fabric_ingest_run' || t.name === 'fabric_extract'
  )
}
