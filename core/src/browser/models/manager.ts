import { Model, ModelEvent } from '../../types'
import { events } from '../events'

/**
 * Manages the registered models across extensions.
 */
export class ModelManager {
  public models = new Map<string, Model>()
  private static cachedInstance: ModelManager | undefined
  private updateEventScheduled = false

  constructor() {
    if (typeof window !== 'undefined') {
      window.core ??= {}
      window.core.modelManager = this
    }
  }

  /**
   * Registers a model.
   * @param model - The model to register.
   */
  register<T extends Model>(model: T) {
    if (this.models.has(model.id)) {
      const existing = this.models.get(model.id)!
      const merged = { ...existing }
      for (const [key, value] of Object.entries(model)) {
        if (value !== undefined) {
          (merged as Record<string, unknown>)[key] = value
        }
      }
      this.models.set(model.id, merged as Model)
    } else {
      this.models.set(model.id, model)
    }
    this.scheduleModelsUpdate()
  }

  private scheduleModelsUpdate() {
    if (this.updateEventScheduled) return
    this.updateEventScheduled = true
    queueMicrotask(() => {
      this.updateEventScheduled = false
      events.emit(ModelEvent.OnModelsUpdate, {})
    })
  }

  /**
   * Retrieves a model by it's id.
   * @param id - The id of the model to retrieve.
   * @returns The model, if found.
   */
  get<T extends Model>(id: string): T | undefined {
    return this.models.get(id) as T | undefined
  }

  /**
   * Shared instance of ExtensionManager.
   */
  static instance() {
    const windowManager =
      typeof window !== 'undefined' ? window.core?.modelManager : undefined

    if (windowManager) {
      this.cachedInstance = windowManager as ModelManager
      return windowManager as ModelManager
    }

    if (!this.cachedInstance) {
      this.cachedInstance = new ModelManager()
    }

    return this.cachedInstance
  }
}
