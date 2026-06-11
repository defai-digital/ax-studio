/**
 * EventEmitter class - matches Ax-Studio event emitter interface
 * Used by ExtensionProvider to set window.core.events
 */

type EventHandler = (...args: unknown[]) => void

export class EventEmitter {
  private handlers: Map<string, EventHandler[]>
  private static MAX_LISTENERS = 50

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

    const count = this.handlers.get(eventName)?.length ?? 0
    if (count > EventEmitter.MAX_LISTENERS) {
      console.warn(
        `EventEmitter: "${eventName}" has ${count} listeners (max ${EventEmitter.MAX_LISTENERS}). Possible memory leak.`
      )
    }

    // Return an unsubscribe function that captures the exact handler reference
    return () => this.off(eventName, handler)
  }

  public off(eventName: string, handler: EventHandler): void {
    if (!this.handlers.has(eventName)) {
      return
    }

    const handlers = this.handlers.get(eventName)
    const index = handlers?.indexOf(handler)

    if (index !== undefined && index !== -1) {
      handlers?.splice(index, 1)
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
