import { z } from 'zod/v4'

const modelItemSchema = z.union([z.string(), z.object({ id: z.string() })])

export const openaiModelsResponseSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
})

export const altModelsResponseSchema = z.object({
  models: z.array(modelItemSchema),
})

export const providerModelsResponseSchema = z.union([
  openaiModelsResponseSchema,
  altModelsResponseSchema,
  z.array(modelItemSchema),
])

export type ProviderModelsResponse = z.infer<typeof providerModelsResponseSchema>
