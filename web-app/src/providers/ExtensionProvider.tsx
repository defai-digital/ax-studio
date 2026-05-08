import { ExtensionManager } from '@/lib/extension'
import { APIs } from '@/lib/service'
import { EventEmitter } from '@/services/events/EventEmitter'
import { EngineManager, ModelManager } from '@ax-studio/core'
import { PropsWithChildren, useCallback, useEffect } from 'react'
import { withTimeout } from '@/lib/utils/async'

const EXTENSION_START_TIMEOUT_MS = 8000

export function ExtensionProvider({ children }: PropsWithChildren) {
  const setupExtensions = useCallback(async () => {
    const core =
      window.core ?? ({ api: APIs } as NonNullable<Window['core']>)
    window.core = core
    core.api = APIs

    core.events ??= new EventEmitter()
    core.extensionManager = new ExtensionManager()
    core.engineManager = new EngineManager()
    core.modelManager = new ModelManager()

    const extensionManager = ExtensionManager.getInstance()
    await withTimeout(
      extensionManager.registerActive().then(() => extensionManager.load()),
      EXTENSION_START_TIMEOUT_MS,
      `Extension startup timed out after ${EXTENSION_START_TIMEOUT_MS}ms`
    )
  }, [])

  useEffect(() => {
    let cancelled = false
    setupExtensions().then(() => {
      if (cancelled) return
      console.info('[ExtensionProvider] Extension setup finished')
    }).catch((err) => {
      console.error('Extension setup failed, rendering app anyway:', err)
    })

    return () => {
      cancelled = true
      ExtensionManager.getInstance().unload()
    }
  }, [setupExtensions])

  return <>{children}</>
}
