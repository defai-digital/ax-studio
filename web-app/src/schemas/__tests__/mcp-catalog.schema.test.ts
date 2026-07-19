import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  MCP_CATALOG_ALLOWED_COMMANDS,
  mcpCatalogEntrySchema,
  parseMcpCatalog,
} from '../mcp-catalog.schema'
import bundledCatalog from '@/constants/mcp-catalog.json'

const validStdioEntry = {
  name: 'filesystem',
  title: 'Filesystem',
  description: 'Read and write local files',
  publisher: 'Model Context Protocol',
  repoUrl: 'https://github.com/modelcontextprotocol/servers',
  version: '2026.7.10',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem@2026.7.10'],
  capabilitiesNote: 'Can read and write files in allowed directories',
}

const validHttpEntry = {
  name: 'exa',
  title: 'Exa Search',
  description: 'Web search for AI',
  publisher: 'Exa',
  repoUrl: 'https://github.com/exa-labs/exa-mcp-server',
  version: '3.2.1',
  transport: 'http',
  url: 'https://mcp.exa.ai/mcp',
  capabilitiesNote: 'Sends queries to Exa servers',
}

describe('mcp-catalog.schema', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps the command whitelist in sync with Rust ALLOWED_COMMANDS', () => {
    // src-tauri/src/core/mcp/helpers.rs:
    //   const ALLOWED_COMMANDS: &[&str] = &["node", "python", "python3", "bun", "npx", "uvx"];
    expect([...MCP_CATALOG_ALLOWED_COMMANDS]).toEqual([
      'node',
      'python',
      'python3',
      'bun',
      'npx',
      'uvx',
    ])
  })

  it('parses the bundled catalog with every entry valid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const entries = parseMcpCatalog(bundledCatalog)
    expect(entries).toHaveLength(bundledCatalog.length)
    expect(entries.length).toBeGreaterThanOrEqual(8)
    expect(entries.length).toBeLessThanOrEqual(10)
    expect(warn).not.toHaveBeenCalled()
    // Spec requirements: at least one http entry, at least two secret env vars
    expect(entries.some((e) => e.transport === 'http')).toBe(true)
    expect(
      entries.filter((e) => e.env?.some((v) => v.secret)).length
    ).toBeGreaterThanOrEqual(2)
    // No deprecated keys the backend deletes on read
    const deprecated = ['AX Studio Browser MCP', 'Ax-Studio Browser MCP', 'browsermcp', 'fetch', 'serper']
    expect(entries.some((e) => deprecated.includes(e.name))).toBe(false)
  })

  it('accepts a valid stdio entry and a valid http entry', () => {
    expect(mcpCatalogEntrySchema.safeParse(validStdioEntry).success).toBe(true)
    expect(mcpCatalogEntrySchema.safeParse(validHttpEntry).success).toBe(true)
  })

  it('rejects a command outside the spawn whitelist', () => {
    const result = mcpCatalogEntrySchema.safeParse({
      ...validStdioEntry,
      command: 'bash',
    })
    expect(result.success).toBe(false)
  })

  it('requires a command for stdio entries', () => {
    const { command: _command, ...withoutCommand } = validStdioEntry
    expect(mcpCatalogEntrySchema.safeParse(withoutCommand).success).toBe(false)
  })

  it('requires a URL for http entries', () => {
    const { url: _url, ...withoutUrl } = validHttpEntry
    expect(mcpCatalogEntrySchema.safeParse(withoutUrl).success).toBe(false)
  })

  it('rejects non-https remote URLs but allows loopback http', () => {
    expect(
      mcpCatalogEntrySchema.safeParse({
        ...validHttpEntry,
        url: 'http://mcp.exa.ai/mcp',
      }).success
    ).toBe(false)
    expect(
      mcpCatalogEntrySchema.safeParse({
        ...validHttpEntry,
        url: 'http://127.0.0.1:31421/mcp',
      }).success
    ).toBe(true)
    expect(
      mcpCatalogEntrySchema.safeParse({
        ...validHttpEntry,
        url: 'http://localhost:8080/mcp',
      }).success
    ).toBe(true)
  })

  it('rejects non-https repo URLs', () => {
    expect(
      mcpCatalogEntrySchema.safeParse({
        ...validStdioEntry,
        repoUrl: 'http://github.com/modelcontextprotocol/servers',
      }).success
    ).toBe(false)
  })

  it('rejects names that are not valid MCP identifiers', () => {
    expect(
      mcpCatalogEntrySchema.safeParse({
        ...validStdioEntry,
        name: 'my server; rm -rf',
      }).success
    ).toBe(false)
  })

  it('drops invalid entries while keeping valid ones', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const entries = parseMcpCatalog([
      validStdioEntry,
      { ...validHttpEntry, command: 'curl' }, // whitelisted-out command
      { not: 'an entry' },
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('filesystem')
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('returns an empty catalog with a warning when the payload is not an array', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseMcpCatalog({ nope: true })).toEqual([])
    expect(parseMcpCatalog(null)).toEqual([])
    expect(parseMcpCatalog('catalog')).toEqual([])
    expect(warn).toHaveBeenCalledTimes(3)
  })
})
