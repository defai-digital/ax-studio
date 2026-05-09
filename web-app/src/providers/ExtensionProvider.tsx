import { ExtensionManager } from '@/lib/extension'
import { ensureCoreBridge } from '@/lib/bootstrap/core-bridge'
import { EngineManager, ModelManager } from '@ax-studio/core'
import { PropsWithChildren, useCallback, useEffect, useState } from 'react'
import { withTimeout } from '@/lib/utils/async'

const EXTENSION_START_TIMEOUT_MS = 8000

export function ExtensionProvider({ children }: PropsWithChildren) {
  const [isReady, setIsReady] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)

  const setupExtensions = useCallback(async () => {
    const core = ensureCoreBridge({ withApi: true, withEvents: true })
    core.extensionManager ??= new ExtensionManager()
    core.engineManager ??= new EngineManager()
    core.modelManager ??= new ModelManager()

    const extensionManager = ExtensionManager.getInstance()
    await withTimeout(
      extensionManager.registerActive().then(() => extensionManager.load()),
      EXTENSION_START_TIMEOUT_MS,
      `Extension startup timed out after ${EXTENSION_START_TIMEOUT_MS}ms`
    )
  }, [])

  useEffect(() => {
    let cancelled = false
    setIsReady(false)
    setInitError(null)

    setupExtensions().then(() => {
      if (cancelled) return
      console.info('[ExtensionProvider] Extension setup finished')
      setIsReady(true)
    }).catch((err) => {
      if (cancelled) return
      console.error('Extension setup failed, rendering app anyway:', err)
      setInitError(err instanceof Error ? err.message : String(err))
      setIsReady(true)
    })

    return () => {
      cancelled = true
      ExtensionManager.getInstance().unload()
    }
  }, [setupExtensions])

  if (!isReady) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur">
        <div className="relative flex h-20 w-20 items-center justify-center">
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-dashed border-primary/60 border-t-transparent" />
          <img
            src="/images/ax-studio-logo.png"
            alt="Ax-Studio"
            className="h-14 w-14 animate-pulse rounded-2xl object-contain"
          />
        </div>
        <div className="text-sm text-muted-foreground">
          Loading Ax-Studio extensions…
        </div>
      </div>
    )
  }

  if (initError) {
    console.warn('[ExtensionProvider] Continuing after extension setup error:', initError)
  }

  return <>{children}</>
}
