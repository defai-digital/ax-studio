import { useEffect, useState } from 'react'
import { initializeServiceHub } from '@/services'
import { initializeServiceHubStore } from '@/hooks/useServiceHub'

interface ServiceHubProviderProps {
  children: React.ReactNode
}

export function ServiceHubProvider({ children }: ServiceHubProviderProps) {
  const [isReady, setIsReady] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setInitError(null)
    setIsReady(false)

    initializeServiceHub()
      .then((hub) => {
        if (cancelled) return
        console.log('Services initialized, initializing Zustand store')
        initializeServiceHubStore(hub)
        setIsReady(true)
      })
      .catch((error) => {
        if (cancelled) return
        console.error('Service initialization failed:', error)
        setInitError(error instanceof Error ? error.message : 'Unknown error')
        setIsReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [attempt])

  if (!isReady) return null

  if (initError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center">
        <div className="max-w-lg space-y-3">
          <h1 className="text-lg font-semibold">AX Studio failed to initialize</h1>
          <p className="text-sm text-muted-foreground">
            Service startup failed. You can retry — some failures are transient
            (for example momentary IPC/resource contention).
          </p>
          <p className="text-xs text-muted-foreground/80">
            {initError.length > 200 ? initError.slice(0, 200) + '…' : initError}
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
