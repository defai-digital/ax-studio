import { z } from 'zod/v4'

export const assistantSchema = z.object({
  id: z.string(),
  name: z.string(),
  created_at: z.number(),
  avatar: z.string().optional(),
  description: z.string().optional(),
  instructions: z.string().optional().default(''),
  parameters: z.record(z.string(), z.unknown()).optional().default({}),
  type: z.enum(['assistant', 'agent']).optional(),
  role: z.string().optional(),
  goal: z.string().optional(),
  model_override_id: z.string().optional(),
  tool_scope: z
    .object({
      mode: z.enum(['all', 'include', 'exclude']),
      tool_keys: z.array(z.string()),
    })
    .optional(),
  max_steps: z.number().optional(),
  timeout: z
    .object({
      total_ms: z.number().optional(),
      step_ms: z.number().optional(),
    })
    .optional(),
  max_result_tokens: z.number().optional(),
  optional: z.boolean().optional(),
})

export const assistantsSchema = z.array(assistantSchema)
