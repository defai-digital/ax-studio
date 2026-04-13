/* eslint-disable @typescript-eslint/no-explicit-any */
import type { EngineManager, ModelManager } from '@ax-studio/core'
import type { ExtensionManager } from '@/lib/extension'

export {}

declare module 'react-syntax-highlighter-virtualized-renderer'

type AppCore = {
  api: Record<string, (...args: any[]) => any> & {
    openExternalUrl: (url: string) => void
  }
  events?: {
    on: (eventName: string, handler: (...args: any[]) => void) => (() => void) | void
    off: (eventName: string, handler: (...args: any[]) => void) => void
    emit: (eventName: string, args: any) => void
  }
  extensionManager?: ExtensionManager
  engineManager?: EngineManager
  modelManager?: ModelManager
}

declare global {
  declare const IS_TAURI: boolean
  declare const IS_WEB_APP: boolean
  declare const IS_MACOS: boolean
  declare const IS_WINDOWS: boolean
  declare const PLATFORM: string
  declare const VERSION: string
  declare const AUTO_UPDATER_DISABLED: boolean
  declare const UPDATE_CHECK_INTERVAL_MS: number
  declare const GA_MEASUREMENT_ID: string
  declare const IS_DEV: boolean
  interface Window {
    core: AppCore | undefined
    gtag?: (...args: unknown[]) => void
    dataLayer?: unknown[]
  }
}
