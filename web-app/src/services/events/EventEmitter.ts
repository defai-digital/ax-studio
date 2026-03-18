/**
 * EventEmitter class - matches Ax-Studio event emitter interface
 * Used by ExtensionProvider to set window.core.events
 */

/* eslint-disable @typescript-eslint/no-unsafe-function-type */
export class EventEmitter {
  private handlers: Map<string, Function[]>

  constructor() {
    this.handlers = new Map<string, Function[]>()
  }

  /**
   * Register an event handler. Returns an unsubscribe function so callers
   * using inline lambdas can still remove their listener without keeping
   * a reference to the original function.
   */
  public on(eventName: string, handler: Function): () => void {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, [])
    }

    this.handlers.get(eventName)?.push(handler)

    // Return an unsubscribe function that captures the exact handler reference
    return () => this.off(eventName, handler)
  }

  public off(eventName: string, handler: Function): void {
    if (!this.handlers.has(eventName)) {
      return
    }

    const handlers = this.handlers.get(eventName)
    const index = handlers?.indexOf(handler)

    if (index !== undefined && index !== -1) {
      handlers?.splice(index, 1)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public emit(eventName: string, args: any): void {
    if (!this.handlers.has(eventName)) {
      return
    }

    const handlers = this.handlers.get(eventName)

    handlers?.forEach((handler) => {
      handler(args)
    })
  }
}
