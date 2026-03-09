import { z } from 'zod/v4'

export const deepLinkPayloadSchema = z.string()

export type DeepLinkPayload = z.infer<typeof deepLinkPayloadSchema>
