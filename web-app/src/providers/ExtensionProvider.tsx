import { ExtensionManager } from '@/lib/extension'
import { APIs } from '@/lib/service'
import { EventEmitter } from '@/services/events/EventEmitter'
import { EngineManager, ModelManager } from '@ax-studio/core'
import { PropsWithChildren, useCallback, useEffect, useState } from 'react'

export function ExtensionProvider({ children }: PropsWithChildren) {
  const [finishedSetup, setFinishedSetup] = useState(false)
  const setupExtensions = useCallback(async () => {
    // Setup core window object for both platforms
    const core =
      window.core ?? ({ api: APIs } as NonNullable<Window['core']>)
    window.core = core
    core.api = APIs

    core.events = new EventEmitter()
    core.extensionManager = new ExtensionManager()
    core.engineManager = new EngineManager()
    core.modelManager = new ModelManager()

    // Register extensions - same pattern for both platforms
    await ExtensionManager.getInstance()
      .registerActive()
      .then(() => ExtensionManager.getInstance().load())
      .then(() => setFinishedSetup(true))
      .catch((err) => {
        console.error('Extension setup failed, rendering app anyway:', err)
        setFinishedSetup(true)
      })
  }, [])

  useEffect(() => {
    setupExtensions()

    return () => {
      // Cleanup unloads extensions exactly once. We don't need a cancelled
      // flag here — any in-flight setup will race with unload, but unloading
      // after setup completes in a cleanup is the expected behaviour.
      ExtensionManager.getInstance().unload()
    }
  }, [setupExtensions])

  return <>{finishedSetup && children}</>
}
