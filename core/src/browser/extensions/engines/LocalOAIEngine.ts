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

  private readonly handleModelInit = (model: Model) => {
    void this.loadModel(model)
  }

  private readonly handleModelStop = (model: Model) => {
    void this.unloadModel(model)
  }

  /**
   * This class represents a base for local inference providers in the OpenAI architecture.
   * It extends the OAIEngine class and provides the implementation of loading and unloading models locally.
   * The loadModel function subscribes to the ModelEvent.OnModelInit event, loading models when initiated.
   * The unloadModel function subscribes to the ModelEvent.OnModelStop event, unloading models when stopped.
   */
  override onLoad() {
    super.onLoad()
    // These events are applicable to local inference providers
    events.on(ModelEvent.OnModelInit, this.handleModelInit)
    events.on(ModelEvent.OnModelStop, this.handleModelStop)
  }

  override onUnload() {
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
