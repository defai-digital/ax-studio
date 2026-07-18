import { useCallback, useMemo } from 'react'
import catalogJson from '@/constants/mcp-catalog.json'
import { parseMcpCatalog } from '@/schemas/mcp-catalog.schema'
import { useMCPServers } from '@/hooks/tools/useMCPServers'

/**
 * Bundled curated MCP catalog. Entries are validated against
 * `mcpCatalogEntrySchema` once per session; invalid entries are dropped
 * (with a console warning) instead of reaching the UI.
 */
export function useMcpCatalog() {
  const mcpServers = useMCPServers((state) => state.mcpServers)

  const entries = useMemo(() => parseMcpCatalog(catalogJson), [])

  const isInstalled = useCallback(
    (name: string) => Object.prototype.hasOwnProperty.call(mcpServers, name),
    [mcpServers]
  )

  return { entries, isInstalled }
}
