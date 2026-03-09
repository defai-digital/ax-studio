import { z } from 'zod/v4'

// Lenient on command/args/env so http/sse servers without a command don't get dropped
export const mcpServerConfigSchema = z.object({
  command: z.string().optional().default(''),
  args: z.array(z.string()).optional().default([]),
  env: z.record(z.string(), z.string()).optional().default({}),
  active: z.boolean().optional(),
  type: z.enum(['stdio', 'http', 'sse']).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  timeout: z.number().optional(),
  official: z.boolean().optional(),
  managed: z.boolean().optional(),
  integration: z.string().optional(),
})

export const mcpServersSchema = z.record(z.string(), mcpServerConfigSchema)

export const mcpSettingsSchema = z.object({
  toolCallTimeoutSeconds: z.number(),
  baseRestartDelayMs: z.number(),
  maxRestartDelayMs: z.number(),
  backoffMultiplier: z.number(),
})

export type MCPServerConfigParsed = z.infer<typeof mcpServerConfigSchema>
export type MCPServersParsed = z.infer<typeof mcpServersSchema>
export type MCPSettingsParsed = z.infer<typeof mcpSettingsSchema>
