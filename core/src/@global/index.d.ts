import { APIFunctions } from '../types/api'

interface EventEmitter {
  on(eventName: string, handler: Function): () => void
  off(eventName: string, handler: Function): void
  emit(eventName: string, args: any): void
}

interface Core {
  api: APIFunctions
  events: EventEmitter
  extensionManager?: any
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
