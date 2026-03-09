import { z } from 'zod/v4'

export const themeStorageSchema = z.object({
  state: z
    .object({
      activeTheme: z.enum(['auto', 'dark', 'light']).optional(),
      isDark: z.boolean().optional(),
    })
    .optional(),
})

export type ThemeStorage = z.infer<typeof themeStorageSchema>
