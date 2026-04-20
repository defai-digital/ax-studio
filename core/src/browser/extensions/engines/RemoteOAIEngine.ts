import type { SecretString } from '../../../types'
import { OAIEngine } from './OAIEngine'

/**
 * Base OAI Remote Inference Provider
 * Added the implementation of loading and unloading model (applicable to local inference providers)
 */
export abstract class RemoteOAIEngine extends OAIEngine {
  apiKey?: SecretString
  /**
   * On extension load, subscribe to events.
   */
  override onLoad() {
    super.onLoad()
  }

  /**
   * Headers for the inference request
   */
  override async headers(): Promise<HeadersInit> {
    const apiKey = this.apiKey?.getValue()
    if (!apiKey) return {}

    return {
      'Authorization': `Bearer ${apiKey}`,
      'api-key': apiKey,
    }
  }
}
