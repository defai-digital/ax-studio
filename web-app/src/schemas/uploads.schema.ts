import { z } from 'zod/v4'

export const ingestResponseSchema = z.object({
  id: z.string(),
  chunk_count: z.number().optional(),
})

export type IngestResponse = z.infer<typeof ingestResponseSchema>
