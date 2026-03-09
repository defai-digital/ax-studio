import { z } from 'zod/v4'

const hfSiblingSchema = z.object({
  rfilename: z.string(),
  size: z.number().optional(),
  blobId: z.string().optional(),
  lfs: z
    .object({
      sha256: z.string(),
      size: z.number(),
      pointerSize: z.number(),
    })
    .optional(),
})

export const huggingFaceRepoSchema = z.object({
  id: z.string(),
  modelId: z.string(),
  sha: z.string(),
  downloads: z.number(),
  likes: z.number(),
  library_name: z.string().optional(),
  tags: z.array(z.string()),
  pipeline_tag: z.string().optional(),
  createdAt: z.string(),
  last_modified: z.string(),
  private: z.boolean(),
  disabled: z.boolean(),
  gated: z.union([z.boolean(), z.string()]),
  author: z.string(),
  cardData: z
    .object({
      license: z.string().optional(),
      language: z.array(z.string()).optional(),
      datasets: z.array(z.string()).optional(),
      metrics: z.array(z.string()).optional(),
    })
    .optional(),
  siblings: z.array(hfSiblingSchema).optional(),
  readme: z.string().optional(),
})

export type HuggingFaceRepoParsed = z.infer<typeof huggingFaceRepoSchema>
