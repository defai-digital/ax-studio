import { z } from 'zod/v4'

export const serviceConfigStorageSchema = z.object({
  state: z
    .object({
      config: z
        .object({
          retrievalServiceUrl: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
})

export type ServiceConfigStorage = z.infer<typeof serviceConfigStorageSchema>
