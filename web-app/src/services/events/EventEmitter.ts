/**
 * EventEmitter class - matches Ax-Studio event emitter interface
 * Used by ExtensionProvider to set window.core.events
 */

type EventHandler = (...args: unknown[]) => void

export class EventEmitter {
  private handlers: Map<string, EventHandler[]>

  constructor() {
    this.handlers = new Map<string, EventHandler[]>()
  }

  /**
   * Register an event handler. Returns an unsubscribe function so callers
   * using inline lambdas can still remove their listener without keeping
   * a reference to the original function.
   */
  public on(eventName: string, handler: EventHandler): () => void {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, [])
    }

    this.handlers.get(eventName)?.push(handler)

    // Return an unsubscribe function that captures the exact handler reference
    return () => this.off(eventName, handler)
  }

  public off(eventName: string, handler: EventHandler): void {
    const handlers = this.handlers.get(eventName)
    if (!handlers) return

    const index = handlers.indexOf(handler)
    if (index !== -1) {
      handlers.splice(index, 1)
    }
    if (handlers.length === 0) {
      this.handlers.delete(eventName)
    }
  }

  public emit(eventName: string, args: unknown): void {
    if (!this.handlers.has(eventName)) {
      return
    }

    const handlers = this.handlers.get(eventName)

    handlers?.forEach((handler) => {
      try {
        handler(args)
      } catch (error) {
        console.error(`Event handler for "${eventName}" failed:`, error)
      }
    })
  }
}
