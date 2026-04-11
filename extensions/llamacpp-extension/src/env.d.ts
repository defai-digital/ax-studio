import type { SettingComponentProps } from '@ax-studio/core'

// Build-time constants injected by rolldown define (see rolldown.config.mjs).
// Declared here so TypeScript resolves them without `declare const` in source
// files, which would prevent rolldown from replacing them.

declare global {
  type SettingDefinition = SettingComponentProps

  const SETTINGS: SettingDefinition[]
  const ENGINE: string
  const IS_WINDOWS: boolean
  const IS_MACOS: boolean
  const IS_LINUX: boolean
}

export {}
