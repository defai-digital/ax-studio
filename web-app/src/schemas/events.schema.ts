import { z } from 'zod/v4'

export const deepLinkPayloadSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    try {
      new URL(value)
      return true
    } catch {
      return false
    }
  }, 'Deep link payload must be a valid URL')

export type DeepLinkPayload = z.infer<typeof deepLinkPayloadSchema>
