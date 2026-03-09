import { z } from 'zod/v4'

export const mcpToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  server: z.string(),
})

export const mcpToolCallResultSchema = z.object({
  error: z.string(),
  content: z.array(
    z.object({
      type: z.string().optional(),
      text: z.string().optional(),
    })
  ),
})

export const getToolsResponseSchema = z.object({
  tools: z.array(mcpToolSchema),
})

export const parseDocumentResponseSchema = z.object({
  content: z.string(),
})

export type MCPToolParsed = z.infer<typeof mcpToolSchema>
export type MCPToolCallResultParsed = z.infer<typeof mcpToolCallResultSchema>
