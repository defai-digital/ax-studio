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
        // Free the entry once the last subscriber goes away so the
        // event-name registry cannot grow without bound over the process
        // lifetime.
        if (current.size === 0) handlers.delete(eventName)
      }
    },
    off: (eventName, handler) => {
      const current = handlers.get(eventName)
      if (!current) return
      current.delete(handler as EventHandler)
      if (current.size === 0) handlers.delete(eventName)
    },
    emit: (eventName, object) => {
      const registered = handlers.get(eventName)
      if (!registered) return
      // Isolate handler failures so one throwing subscriber cannot drop the rest.
      for (const handler of [...registered]) {
        try {
          handler(object)
        } catch (error) {
          console.error(
            `[events] Handler for "${eventName}" threw; continuing with remaining handlers:`,
            error
          )
        }
      }
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
const on = <T = unknown>(
  eventName: string,
  handler: EventHandler<T>
): (() => void) => {
  const bridge = getEventsBridge()
  const unsubscribe = bridge.on(eventName, handler as EventHandler)
  return typeof unsubscribe === 'function'
    ? unsubscribe
    : () => bridge.off(eventName, handler as EventHandler)
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
