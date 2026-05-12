import { useEffect, useState } from 'react'
import { initializeServiceHub } from '@/services'
import { initializeServiceHubStore } from '@/hooks/useServiceHub'
import { withTimeout } from '@/lib/utils/async'

const SERVICE_HUB_INIT_TIMEOUT_MS = 12_000
const LOADING_DETAIL_DELAY_MS = 900
const SLOW_LOADING_DELAY_MS = 5_000

interface ServiceHubProviderProps {
  children: React.ReactNode
}

export function ServiceHubProvider({ children }: ServiceHubProviderProps) {
  const [isReady, setIsReady] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [loadingPhase, setLoadingPhase] = useState<'starting' | 'working' | 'slow'>('starting')

  useEffect(() => {
    let cancelled = false
    const startTime = Date.now()
    const detailTimerId = window.setTimeout(() => {
      if (!cancelled) {
        setLoadingPhase('working')
      }
    }, LOADING_DETAIL_DELAY_MS)
    const slowTimerId = window.setTimeout(() => {
      if (!cancelled) {
        setLoadingPhase('slow')
      }
    }, SLOW_LOADING_DELAY_MS)
    setInitError(null)
    setIsReady(false)
    setLoadingPhase('starting')

    console.info('[ServiceHubProvider] Initializing service hub...')
    withTimeout(
      Promise.resolve().then(() => initializeServiceHub()),
      SERVICE_HUB_INIT_TIMEOUT_MS,
      `Service hub initialization timed out after ${SERVICE_HUB_INIT_TIMEOUT_MS}ms`
    )
      .then((hub) => {
        if (cancelled) return
        initializeServiceHubStore(hub)
        const readyMs = Date.now() - startTime
        console.info(`[ServiceHubProvider] Service hub ready in ${readyMs}ms`)
        setIsReady(true)
      })
      .catch((error) => {
        if (cancelled) return
        const message =
          error instanceof Error ? error.message : 'Unknown error'
        console.error('[ServiceHubProvider] Service initialization failed:', error)
        setInitError(message)
        setIsReady(true)
      })

    return () => {
      cancelled = true
      clearTimeout(detailTimerId)
      clearTimeout(slowTimerId)
    }
  }, [attempt])

  const loadingMessage =
    loadingPhase === 'slow'
      ? 'Still preparing local services...'
      : loadingPhase === 'working'
        ? 'Preparing local services...'
        : 'Initializing Ax-Studio...'

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
          {loadingMessage}
        </div>
      </div>
    )
  }

  if (initError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center">
        <div className="max-w-lg space-y-3">
          <h1 className="text-lg font-semibold">AX Studio failed to initialize</h1>
          <p className="text-sm text-muted-foreground">
            Service startup failed. You can retry; some failures are transient
            (for example momentary IPC/resource contention).
          </p>
          <p className="text-xs text-muted-foreground/80">
            {initError.length > 200 ? initError.slice(0, 200) + '...' : initError}
          </p>
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="inline-flex items-center justify-center rounded-md border px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
