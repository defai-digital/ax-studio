import { AIEngine } from './AIEngine'

/**
 * Manages the registration and retrieval of inference engines.
 */
export class EngineManager {
  public engines = new Map<string, AIEngine>()
  public controller: AbortController | null = null
  private static cachedInstance: EngineManager | null = null

  /**
   * Registers an engine.
   * @param engine - The engine to register.
   */
  register<T extends AIEngine>(engine: T) {
    this.engines.set(engine.provider, engine)
  }

  /**
   * Retrieves a engine by provider.
   * @param provider - The name of the engine to retrieve.
   * @returns The engine, if found.
   */
  get<T extends AIEngine>(provider: string): T | undefined {
    return this.engines.get(provider) as T | undefined
  }

  /**
   * The instance of the engine manager.
   *
   * Always check `window.core.engineManager` first so HMR or
   * multi-window scenarios that replace the shared instance are
   * reflected. The previous implementation consulted the static cache
   * first and could keep returning a stale instance whose `engines` map
   * had been detached from the one actually being written to.
   *
   * When no shared instance exists (tests, early init), we create one
   * and publish it back through `window.core` so later callers see the
   * same instance.
   */
  static instance(): EngineManager {
    const globalWindow: (Window & typeof globalThis) | undefined =
      typeof window !== 'undefined' ? window : undefined

    const windowManager = globalWindow?.core?.engineManager as
      | EngineManager
      | undefined

    if (windowManager) {
      this.cachedInstance = windowManager
      return windowManager
    }

    if (!this.cachedInstance) {
      this.cachedInstance = new EngineManager()
      if (globalWindow) {
        globalWindow.core = globalWindow.core ?? ({} as NonNullable<Window['core']>)
        globalWindow.core.engineManager = this.cachedInstance
      }
    }

    return this.cachedInstance
  }
}
