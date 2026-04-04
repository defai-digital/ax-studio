import { APIFunctions } from '../types/api'

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
  api: APIFunctions
  events: EventEmitter
  extensionManager?: ExtensionManager
}

export {}

declare global {
  namespace NodeJS {
    interface Global {
      core: Core
    }
  }
  var core: Core | undefined
}
