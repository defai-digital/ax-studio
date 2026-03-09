import { useEffect, useState } from 'react'
import { initializeServiceHub } from '@/services'
import { initializeServiceHubStore } from '@/hooks/useServiceHub'
import { useAxStudioConfig } from '@/stores/useAxStudioConfig'

interface ServiceHubProviderProps {
  children: React.ReactNode
}

export function ServiceHubProvider({ children }: ServiceHubProviderProps) {
  const [isReady, setIsReady] = useState(false)
  const [initError, setInitError] = useState<string | null>(null)

  useEffect(() => {
    // Sync persisted service URLs to the Rust backend so the proxy server
    // can forward /retrieval/*, /agents/*, /vectors/* to the correct services.
    useAxStudioConfig.getState().syncToBackend().catch(() => {
      // Non-fatal: may not be in Tauri context
    })

    initializeServiceHub()
      .then((hub) => {
        console.log('Services initialized, initializing Zustand store')
        initializeServiceHubStore(hub)
        setIsReady(true)
      })
      .catch((error) => {
        console.error('Service initialization failed:', error)
        const message = error instanceof Error ? error.message : 'Unknown error'
        setInitError(message)
        setIsReady(true)
      })
  }, [])

  if (!isReady) return null

  if (initError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center">
        <div className="max-w-lg space-y-3">
          <h1 className="text-lg font-semibold">AX Studio failed to initialize</h1>
          <p className="text-sm text-muted-foreground">
            Service startup failed. Please restart the app.
          </p>
          <p className="text-xs text-muted-foreground/80">{initError}</p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
