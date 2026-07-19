import { Model, ModelEvent } from '../../types'
import { events } from '../events'

/**
 * Manages the registered models across extensions.
 */
export class ModelManager {
  private readonly modelMap = new Map<string, Model>()
  private static cachedInstance: ModelManager | undefined
  private updateEventScheduled = false

  constructor() {
    if (typeof window !== 'undefined') {
      if (!window.core?.modelManager) {
        window.core ??= {}
        window.core.modelManager = this
      }
    }
  }

  /**
   * Registers a model.
   * @param model - The model to register.
   */
  register<T extends Model>(model: T) {
    if (this.modelMap.has(model.id)) {
      const existing = this.modelMap.get(model.id)!
      // Deep-ish merge for nested plain objects so callers cannot leave shared
      // mutable references that later corrupt the registry.
      const merged = { ...existing } as Record<string, unknown>
      for (const [key, value] of Object.entries(model)) {
        if (value === undefined) continue
        const previous = merged[key]
        if (
          value !== null &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          previous !== null &&
          typeof previous === 'object' &&
          !Array.isArray(previous)
        ) {
          merged[key] = {
            ...(previous as Record<string, unknown>),
            ...(value as Record<string, unknown>),
          }
        } else if (Array.isArray(value)) {
          merged[key] = [...value]
        } else {
          merged[key] = value
        }
      }
      this.modelMap.set(model.id, merged as Model)
    } else {
      this.modelMap.set(model.id, cloneModel(model))
    }
    this.scheduleModelsUpdate()
  }

  private scheduleModelsUpdate() {
    if (this.updateEventScheduled) return
    this.updateEventScheduled = true
    queueMicrotask(() => {
      this.updateEventScheduled = false
      try {
        events.emit(ModelEvent.OnModelsUpdate, {})
      } catch (error) {
        console.error('[ModelManager] Failed to emit OnModelsUpdate:', error)
      }
    })
  }

  /**
   * Retrieves a model by its id.
   * @param id - The id of the model to retrieve.
   * @returns The model, if found.
   */
  get<T extends Model>(id: string): T | undefined {
    return this.modelMap.get(id) as T | undefined
  }

  /** Whether a model with the given id is registered. */
  has(id: string): boolean {
    return this.modelMap.has(id)
  }

  /** Number of registered models. */
  get size(): number {
    return this.modelMap.size
  }

  /** Snapshot of all registered models (does not expose the internal Map). */
  getAll(): Model[] {
    return Array.from(this.modelMap.values())
  }

  /**
   * Shared instance of ModelManager.
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

function cloneModel(model: Model): Model {
  const clone = { ...model } as Record<string, unknown>
  for (const [key, value] of Object.entries(clone)) {
    if (Array.isArray(value)) {
      clone[key] = [...value]
    } else if (value !== null && typeof value === 'object') {
      clone[key] = { ...(value as Record<string, unknown>) }
    }
  }
  return clone as Model
}
