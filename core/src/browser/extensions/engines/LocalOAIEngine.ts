import { events } from '../../events'
import { Model, ModelEvent } from '../../../types'
import { OAIEngine } from './OAIEngine'

/**
 * Base OAI Local Inference Provider
 * Added the implementation of loading and unloading model (applicable to local inference providers)
 */
export abstract class LocalOAIEngine extends OAIEngine {
  // The inference engine
  abstract nodeModule: string
  loadModelFunctionName: string = 'loadModel'
  unloadModelFunctionName: string = 'unloadModel'

  // Idempotency guard for this subclass's own events. The base class has
  // its own `loaded` flag for the OAIEngine events — this one exists so
  // the ModelInit/ModelStop handlers also register exactly once across
  // repeated `onLoad()` invocations (HMR, manager re-init).
  private localLoaded = false

  private readonly handleModelInit = (model: Model) => {
    void Promise.resolve()
      .then(() => this.loadModel(model))
      .catch((error) => {
        console.error('[LocalOAIEngine] Failed to load model:', error)
      })
  }

  private readonly handleModelStop = (model: Model) => {
    void Promise.resolve()
      .then(() => this.unloadModel(model))
      .catch((error) => {
        console.error('[LocalOAIEngine] Failed to unload model:', error)
      })
  }

  /**
   * This class represents a base for local inference providers in the OpenAI architecture.
   * It extends the OAIEngine class and provides the implementation of loading and unloading models locally.
   * The loadModel function subscribes to the ModelEvent.OnModelInit event, loading models when initiated.
   * The unloadModel function subscribes to the ModelEvent.OnModelStop event, unloading models when stopped.
   */
  override onLoad() {
    // Always call super — OAIEngine has its own idempotency guard.
    super.onLoad()
    if (this.localLoaded) return
    this.localLoaded = true
    // These events are applicable to local inference providers
    events.on(ModelEvent.OnModelInit, this.handleModelInit)
    events.on(ModelEvent.OnModelStop, this.handleModelStop)
  }

  override onUnload() {
    this.localLoaded = false
    events.off(ModelEvent.OnModelInit, this.handleModelInit)
    events.off(ModelEvent.OnModelStop, this.handleModelStop)
    super.onUnload()
  }

  /**
   * Load the model.
   */
  async loadModel(model: Model & { file_path?: string }): Promise<void> {
    // Implementation of loading the model
  }

  /**
   * Stops the model.
   */
  async unloadModel(model?: Model) {
    // Implementation of unloading the model
  }
}
