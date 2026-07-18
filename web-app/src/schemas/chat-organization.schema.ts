import { z } from 'zod/v4'

const chatFolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  updatedAt: z.number(),
  logo: z.string().optional(),
})

const chatTagSchema = z.object({
  id: z.string(),
  name: z.string(),
})

export const chatOrganizationStorageSchema = z.object({
  state: z
    .object({
      folders: z.array(chatFolderSchema).optional(),
      tags: z.array(chatTagSchema).optional(),
    })
    .optional(),
})
