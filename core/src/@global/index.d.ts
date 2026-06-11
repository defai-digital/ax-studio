import { APIFunctions } from '../types/api'
import type { EngineManager } from '../browser/extensions/engines/EngineManager'
import type { ModelManager } from '../browser/models/manager'

type EventHandler<T = unknown> = (payload: T) => void

interface EventEmitter {
  on<T = unknown>(eventName: string, handler: EventHandler<T>): () => void
  off<T = unknown>(eventName: string, handler: EventHandler<T>): void
  emit<T = unknown>(eventName: string, args: T): void
}

interface ExtensionManager {
  getByName<T = unknown>(name: string): T | undefined
}

interface Core {
  api?: APIFunctions
  events?: EventEmitter
  extensionManager?: ExtensionManager
  engineManager?: EngineManager
  modelManager?: ModelManager
}

export {}

declare global {
  interface Window {
    core?: Core
  }

  namespace NodeJS {
    interface Global {
      core: Core | undefined
    }
  }

  var core: Core | undefined
}
