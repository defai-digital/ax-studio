import { ExtensionManager } from '@/lib/extension'
import { ensureCoreBridge } from '@/lib/bootstrap/core-bridge'
import { AppEvent, EngineManager, events, ModelManager } from '@ax-studio/core'
import {
  PropsWithChildren,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { withTimeout } from '@/lib/utils/async'
import { useServiceHub } from '@/hooks/useServiceHub'
import { isApiOnlyPlatform } from '@/lib/platform/utils'
import { toast } from 'sonner'

const EXTENSION_START_TIMEOUT_MS = 8000
const EXTENSIONS_UPDATED_EVENT = 'extensions-updated'
const EXTENSION_START_RETRY_DELAYS_MS = [1500, 5000] as const
let extensionSetupWork: Promise<void> | null = null

// Extensions that already triggered a load-failure toast (fires once per extension)
const extensionFailureToastShown = new Set<string>()

/** Clears toast de-dupe state — used after a successful load and in tests. */
export function resetExtensionFailureToastState() {
  extensionFailureToastShown.clear()
}

function notifyExtensionLoadFailures() {
  const failedNames = ExtensionManager.getInstance().getFailedExtensionNames()
  if (failedNames.length === 0) {
    // Setup failed without an identifiable extension (e.g. startup timeout)
    if (!extensionFailureToastShown.has('*')) {
      extensionFailureToastShown.add('*')
      toast.error(
        'Some extensions failed to load; related features may be unavailable'
      )
    }
    return
  }
  for (const name of failedNames) {
    if (extensionFailureToastShown.has(name)) continue
    extensionFailureToastShown.add(name)
    toast.error(`${name} failed to load; related features may be unavailable`)
  }
}

function notifyProvidersChanged(source: string) {
  window.setTimeout(() => {
    events.emit(AppEvent.onModelImported, { source })
  }, 0)
}

export function ExtensionProvider({ children }: PropsWithChildren) {
  const [initError, setInitError] = useState<string | null>(null)
  const serviceHub = useServiceHub()
  // Lazy one-time manager bootstrap via ref — useMemo must not be used for
  // side effects (React may discard and re-run memoized values).
  const managersReady = useRef(false)
  if (!managersReady.current) {
    const core = ensureCoreBridge({ withApi: true, withEvents: true })
    core.extensionManager ??= new ExtensionManager()
    core.engineManager ??= new EngineManager()
    core.modelManager ??= new ModelManager()
    managersReady.current = true
  }

  const setupExtensions = useCallback(async () => {
    // iPad and Windows ARM64 are API/URL-only product targets. Do not load
    // desktop extensions because they may spawn local inference processes or
    // attempt to install platform-specific binaries.
    if (isApiOnlyPlatform()) return

    const extensionManager = ExtensionManager.getInstance()
    extensionSetupWork ??= extensionManager
      .registerActive()
      .then(() => extensionManager.load())
      .then(() => {
        const failedNames = extensionManager.getFailedExtensionNames()
        if (failedNames.length > 0) {
          throw new Error(`Extensions failed to load: ${failedNames.join(', ')}`)
        }
      })
      .finally(() => {
        extensionSetupWork = null
      })

    await withTimeout(
      extensionSetupWork,
      EXTENSION_START_TIMEOUT_MS,
      `Extension startup timed out after ${EXTENSION_START_TIMEOUT_MS}ms`
    )
  }, [])

  const runSetup = useCallback(
    async (isCancelled: () => boolean) => {
      try {
        await setupExtensions()
        if (isCancelled()) return false

        console.info('[ExtensionProvider] Extension setup finished')
        resetExtensionFailureToastState()
        setInitError(null)
        return true
      } catch (err) {
        if (isCancelled()) return false

        const message = err instanceof Error ? err.message : String(err)
        console.error('Extension setup failed, rendering app anyway:', err)
        setInitError(message)
        return false
      }
    },
    [setupExtensions]
  )

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
    const isCancelled = () => cancelled

    void runSetup(isCancelled).then((ok) => {
      if (cancelled) return
      if (ok) {
        notifyProvidersChanged('extensions-ready')
      }
      if (ok) return
      EXTENSION_START_RETRY_DELAYS_MS.forEach((delayMs, index) => {
        retryTimers.push(
          setTimeout(() => {
            if (cancelled) return
            void runSetup(isCancelled).then((retryOk) => {
              if (cancelled) return
              if (retryOk) {
                notifyProvidersChanged('extensions-ready')
                return
              }
              // Retries exhausted — surface the failure once per extension
              if (index === EXTENSION_START_RETRY_DELAYS_MS.length - 1) {
                notifyExtensionLoadFailures()
              }
            })
          }, delayMs)
        )
      })
    })

    serviceHub
      .events()
      ?.listen(EXTENSIONS_UPDATED_EVENT, () => {
        console.info(
          '[ExtensionProvider] Extensions updated; refreshing active extensions'
        )
        void runSetup(isCancelled).then((ok) => {
          if (ok) {
            notifyProvidersChanged(EXTENSIONS_UPDATED_EVENT)
          }
        })
      })
      .then((cleanup) => {
        if (cancelled) {
          cleanup()
        } else {
          cleanupExtensionsUpdated = cleanup
        }
      })
      .catch((error) => {
        console.error(
          '[ExtensionProvider] Failed to subscribe to extension updates:',
          error
        )
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
