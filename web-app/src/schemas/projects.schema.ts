import { z } from 'zod/v4'

export const threadFolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  updated_at: z.number(),
  assistantId: z.string().optional(),
  logo: z.string().optional(),
  projectPrompt: z.string().nullable().optional(),
})

export const projectsStorageSchema = z.object({
  state: z
    .object({
      folders: z.array(threadFolderSchema),
    })
    .optional(),
})

export type ThreadFolderParsed = z.infer<typeof threadFolderSchema>
