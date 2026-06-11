export type EventHandler<T = unknown> = (payload: T) => void

type CoreEventsBridge = {
  on<T = unknown>(eventName: string, handler: EventHandler<T>): () => void
  off<T = unknown>(eventName: string, handler: EventHandler<T>): void
  emit<T = unknown>(eventName: string, object: T): void
}

const createFallbackEventsBridge = (): CoreEventsBridge => {
  const handlers = new Map<string, Set<EventHandler>>()

  return {
    on: (eventName, handler) => {
      const current = handlers.get(eventName) ?? new Set<EventHandler>()
      current.add(handler as EventHandler)
      handlers.set(eventName, current)
      return () => {
        current.delete(handler as EventHandler)
      }
    },
    off: (eventName, handler) => {
      handlers.get(eventName)?.delete(handler as EventHandler)
    },
    emit: (eventName, object) => {
      handlers.get(eventName)?.forEach((handler) => handler(object))
    },
  }
}

const getEventsBridge = (): CoreEventsBridge => {
  const core = (globalThis.core ??= {})
  core.events ??= createFallbackEventsBridge()
  return core.events as CoreEventsBridge
}

/**
 * Adds an observer for an event.
 *
 * @param eventName The name of the event to observe.
 * @param handler The handler function to call when the event is observed.
 */
const on = <T = unknown>(eventName: string, handler: EventHandler<T>): void => {
  getEventsBridge().on(eventName, handler as EventHandler)
}

/**
 * Removes an observer for an event.
 *
 * @param eventName The name of the event to stop observing.
 * @param handler The handler function to call when the event is observed.
 */
const off = <T = unknown>(eventName: string, handler: EventHandler<T>): void => {
  getEventsBridge().off(eventName, handler as EventHandler)
}

/**
 * Emits an event.
 *
 * @param eventName The name of the event to emit.
 * @param object The object to pass to the event callback.
 */
const emit = <T = unknown>(eventName: string, object: T): void => {
  getEventsBridge().emit(eventName, object)
}

export const events = {
  on,
  off,
  emit,
}
