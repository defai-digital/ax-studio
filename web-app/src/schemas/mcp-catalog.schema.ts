import { z } from 'zod/v4'

// Keep in sync with the Rust spawn whitelist `ALLOWED_COMMANDS` in
// src-tauri/src/core/mcp/helpers.rs — catalog stdio entries may only use
// commands the backend is willing to spawn.
export const MCP_CATALOG_ALLOWED_COMMANDS = [
  'node',
  'python',
  'python3',
  'bun',
  'npx',
  'uvx',
] as const

// Mirrors `is_valid_mcp_identifier` in src-tauri/src/core/mcp/commands.rs.
const MCP_IDENTIFIER_PATTERN = /^[A-Za-z0-9_\-.:/@]{1,128}$/

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

const isLoopbackUrl = (value: string): boolean => {
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(value).hostname)
  } catch {
    return false
  }
}

export const mcpCatalogEnvVarSchema = z.object({
  key: z.string().trim().min(1),
  description: z.string(),
  required: z.boolean(),
  secret: z.boolean(),
  defaultValue: z.string().optional(),
})

export const mcpCatalogEntrySchema = z
  .object({
    name: z
      .string()
      .regex(
        MCP_IDENTIFIER_PATTERN,
        'Catalog entry name must be a valid MCP identifier'
      ),
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    publisher: z.string().trim().min(1),
    repoUrl: z
      .string()
      .trim()
      .url()
      .refine((value) => value.startsWith('https://'), {
        message: 'Catalog repo URL must use https',
      }),
    version: z.string().trim().min(1),
    transport: z.enum(['stdio', 'http', 'sse']),
    command: z.string().trim().optional(),
    args: z.array(z.string()).optional(),
    url: z
      .string()
      .trim()
      .url()
      .refine(
        (value) => value.startsWith('https://') || isLoopbackUrl(value),
        'Catalog server URL must be https (loopback http is allowed)'
      )
      .optional(),
    headers: z.array(mcpCatalogEnvVarSchema).optional(),
    env: z.array(mcpCatalogEnvVarSchema).optional(),
    capabilitiesNote: z.string().trim().min(1),
    timeoutSeconds: z.number().finite().positive().optional(),
  })
  .superRefine((entry, ctx) => {
    if (entry.transport === 'stdio' && !entry.command) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['command'],
        message: 'A stdio catalog entry requires a command',
      })
    }

    if (
      entry.command !== undefined &&
      !MCP_CATALOG_ALLOWED_COMMANDS.includes(
        entry.command as (typeof MCP_CATALOG_ALLOWED_COMMANDS)[number]
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['command'],
        message: `Catalog command must be one of: ${MCP_CATALOG_ALLOWED_COMMANDS.join(', ')}`,
      })
    }

    if (
      (entry.transport === 'http' || entry.transport === 'sse') &&
      !entry.url
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['url'],
        message: 'An HTTP/SSE catalog entry requires a URL',
      })
    }
  })

export type McpCatalogEnvVar = z.infer<typeof mcpCatalogEnvVarSchema>
export type McpCatalogEntry = z.infer<typeof mcpCatalogEntrySchema>

/**
 * Parse the bundled catalog entry-by-entry so one bad entry cannot wipe the
 * whole catalog. A payload that is not an array at all parses to an empty
 * catalog (with a warning) rather than throwing into the UI.
 */
export function parseMcpCatalog(raw: unknown): McpCatalogEntry[] {
  if (!Array.isArray(raw)) {
    console.warn('MCP catalog is not an array, ignoring bundled catalog')
    return []
  }

  const entries: McpCatalogEntry[] = []
  for (const value of raw) {
    const parsed = mcpCatalogEntrySchema.safeParse(value)
    if (parsed.success) {
      entries.push(parsed.data)
    } else {
      const name =
        value && typeof value === 'object' && 'name' in value
          ? String(value.name)
          : '<unknown>'
      console.warn(
        `MCP catalog entry "${name}" invalid, skipping:`,
        parsed.error.message
      )
    }
  }
  return entries
}
