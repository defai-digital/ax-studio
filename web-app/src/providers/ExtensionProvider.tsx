import { ExtensionManager } from '@/lib/extension'
import { ensureCoreBridge } from '@/lib/bootstrap/core-bridge'
import { EngineManager, ModelManager } from '@ax-studio/core'
import { PropsWithChildren, useCallback, useEffect, useMemo, useState } from 'react'
import { withTimeout } from '@/lib/utils/async'
import { useServiceHub } from '@/hooks/useServiceHub'

const EXTENSION_START_TIMEOUT_MS = 8000
const EXTENSIONS_UPDATED_EVENT = 'extensions-updated'
const EXTENSION_START_RETRY_DELAYS_MS = [1500, 5000] as const
let extensionSetupWork: Promise<void> | null = null

export function ExtensionProvider({ children }: PropsWithChildren) {
  const [initError, setInitError] = useState<string | null>(null)
  const serviceHub = useServiceHub()

  useMemo(() => {
    const core = ensureCoreBridge({ withApi: true, withEvents: true })
    core.extensionManager ??= new ExtensionManager()
    core.engineManager ??= new EngineManager()
    core.modelManager ??= new ModelManager()
  }, [])

  const setupExtensions = useCallback(async () => {
    const extensionManager = ExtensionManager.getInstance()
    extensionSetupWork ??= extensionManager
      .registerActive()
      .then(() => extensionManager.load())
      .finally(() => {
        extensionSetupWork = null
      })

    await withTimeout(
      extensionSetupWork,
      EXTENSION_START_TIMEOUT_MS,
      `Extension startup timed out after ${EXTENSION_START_TIMEOUT_MS}ms`
    )
  }, [])

  const runSetup = useCallback(async () => {
    try {
      await setupExtensions()
      console.info('[ExtensionProvider] Extension setup finished')
      setInitError(null)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('Extension setup failed, rendering app anyway:', err)
      setInitError(message)
      return false
    }
  }, [setupExtensions])

  useEffect(() => {
    if (!initError) return
    console.warn(
      '[ExtensionProvider] Continuing after extension setup error:',
      initError
    )
  }, [initError])

  useEffect(() => {
    let cancelled = false
    let cleanupExtensionsUpdated: () => void = () => {}
    const retryTimers: ReturnType<typeof setTimeout>[] = []
    setInitError(null)

    void runSetup().then((ok) => {
      if (cancelled || ok) return
      for (const delayMs of EXTENSION_START_RETRY_DELAYS_MS) {
        retryTimers.push(setTimeout(() => {
          if (cancelled) return
          void runSetup()
        }, delayMs))
      }
    })

    serviceHub
      .events()
      .listen(EXTENSIONS_UPDATED_EVENT, () => {
        console.info('[ExtensionProvider] Extensions updated; refreshing active extensions')
        void runSetup()
      })
      .then((cleanup) => {
        if (cancelled) {
          cleanup()
        } else {
          cleanupExtensionsUpdated = cleanup
        }
      })
      .catch((error) => {
        console.error('[ExtensionProvider] Failed to subscribe to extension updates:', error)
      })

    return () => {
      cancelled = true
      for (const retryTimer of retryTimers) {
        clearTimeout(retryTimer)
      }
      cleanupExtensionsUpdated()
      ExtensionManager.getInstance().unload()
    }
  }, [serviceHub, runSetup])

  return <>{children}</>
}
