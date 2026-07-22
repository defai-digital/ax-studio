/**
 * bootstrap-events — registers the model-imported event listener so providers
 * are refreshed whenever a model file is imported.
 * Pure function; no React, no Zustand imports.
 *
 * Returns a cleanup function that removes the listener.
 */
import type { ServiceHub } from '@/services/index'
import { AppEvent, events } from '@ax-studio/core'

export type BootstrapEventsInput = {
  serviceHub: ServiceHub
  setProviders: (providers: ModelProvider[], pathSep: string) => void
}

/**
 * Attaches the model-imported listener.
 * @returns cleanup — call on unmount to detach the listener.
 */
export function bootstrapEvents(input: BootstrapEventsInput): () => void {
  const { serviceHub, setProviders } = input
  let disposed = false
  let refreshGeneration = 0

  const handleModelImported = () => {
    const generation = ++refreshGeneration
    serviceHub
      .providers()
      .getProviders()
      .then((providers) => {
        if (disposed || generation !== refreshGeneration) return
        setProviders(providers, serviceHub.path().sep())
      })
      .catch((error) => {
        if (disposed || generation !== refreshGeneration) return
        console.error('Failed to reload providers after model import:', error)
      })
  }

  events.on(AppEvent.onModelImported, handleModelImported)

  return () => {
    disposed = true
    refreshGeneration += 1
    events.off(AppEvent.onModelImported, handleModelImported)
  }
}
