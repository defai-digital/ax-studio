// Build-time constants injected by rolldown define (see rolldown.config.mjs).
// Declared here so TypeScript resolves them without `declare const` in source
// files, which would prevent rolldown from replacing them.

declare const SETTINGS: any[]
declare const ENGINE: string
declare const IS_WINDOWS: boolean
declare const IS_MACOS: boolean
declare const IS_LINUX: boolean
