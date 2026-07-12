import { z } from 'zod/v4'

// Lenient on command/args/env so http/sse servers without a command don't get dropped
export const mcpServerConfigSchema = z
  .object({
    command: z.string().optional().default(''),
    args: z.array(z.string()).optional().default([]),
    env: z.record(z.string(), z.string()).optional().default({}),
    active: z.boolean().optional(),
    type: z.enum(['stdio', 'http', 'sse']).optional(),
    url: z
      .string()
      .trim()
      .url()
      .refine(
        (value) => value.startsWith('http://') || value.startsWith('https://'),
        'MCP server URL must start with http:// or https://'
      )
      .optional(),
    headers: z.record(z.string(), z.string()).optional(),
    timeout: z.number().finite().positive().optional(),
    official: z.boolean().optional(),
    managed: z.boolean().optional(),
    integration: z.string().optional(),
  })
  .superRefine((config, ctx) => {
    if (config.type === 'stdio' && !config.command.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['command'],
        message: 'A stdio MCP server requires a command',
      })
    }

    if (
      (config.type === 'http' || config.type === 'sse') &&
      !config.url?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['url'],
        message: 'An HTTP/SSE MCP server requires a URL',
      })
    }
  })

/**
 * Parse MCP servers entry-by-entry so one invalid server cannot wipe the rest
 * (z.record fails the whole map when any value fails).
 */
export function parseMcpServersRecord(
  raw: unknown
): z.infer<typeof mcpServersSchema> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }
  const servers: z.infer<typeof mcpServersSchema> = {}
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = mcpServerConfigSchema.safeParse(value)
    if (parsed.success) {
      servers[name] = parsed.data
    } else {
      console.warn(
        `MCP server "${name}" config invalid, skipping:`,
        parsed.error.message
      )
    }
  }
  return servers
}

export const mcpServersSchema = z.record(z.string(), mcpServerConfigSchema)

export const mcpSettingsSchema = z.object({
  toolCallTimeoutSeconds: z.number().finite().positive().max(3600),
  baseRestartDelayMs: z.number().finite().int().positive().max(60000),
  maxRestartDelayMs: z.number().finite().int().positive().max(600000),
  backoffMultiplier: z.number().finite().gt(1).max(10),
})
