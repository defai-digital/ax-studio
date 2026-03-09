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

  const handleModelImported = () => {
    serviceHub
      .providers()
      .getProviders()
      .then((providers) => {
        setProviders(providers, serviceHub.path().sep())
      })
      .catch((error) => {
        console.error('Failed to reload providers after model import:', error)
      })
  }

  events.on(AppEvent.onModelImported, handleModelImported)

  return () => {
    events.off(AppEvent.onModelImported, handleModelImported)
  }
}
